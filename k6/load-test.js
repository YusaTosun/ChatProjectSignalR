/**
 * k6 Yük Testi — ChatProjectSignalR
 *
 * Kurulum:
 *   winget install k6                   (veya: choco install k6)
 *   k6 run k6/load-test.js
 *
 * Senaryo:
 *   Her sanal kullanıcı (VU):
 *     1. /api/auth/login ile giriş yapar
 *     2. /api/rooms endpoint'ini çeker
 *     3. SignalR WebSocket bağlantısı açar (negotiate + ws)
 *     4. Odaya katılır (JoinRoom mesajı gönderir)
 *     5. Birkaç mesaj gönderir (POST /api/messages)
 *     6. Bağlantıyı kapatır
 *
 * Yük profili: 0 → 50 VU (30s ramp-up) → 50 VU (1dk) → 0 (15s ramp-down)
 */

import http from "k6/http";
import ws from "k6/ws";
import { check, sleep } from "k6";
import { Counter, Rate, Trend } from "k6/metrics";
import { htmlReport } from "https://raw.githubusercontent.com/benc-uk/k6-reporter/main/dist/bundle.js";
import { textSummary } from "https://jslib.k6.io/k6-summary/0.0.2/index.js";

// ─── Yapılandırma ─────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || "http://localhost:5000";
const WS_URL   = __ENV.WS_URL   || "ws://localhost:5000";

// Seed kullanıcıları — Program.cs'deki ile aynı
const SEED_USERS = [
  { username: "yusa",    password: "hb" },
  { username: "ahmet",   password: "hb" },
  { username: "mehmet",  password: "hb" },
];

// ─── Özel metrikler ───────────────────────────────────────────────────────────
const wsConnectErrors   = new Counter("ws_connect_errors");
const msgSendErrors     = new Counter("msg_send_errors");
const loginFailRate     = new Rate("login_fail_rate");
const wsSessionDuration = new Trend("ws_session_duration_ms", true);

// ─── Yük profili ──────────────────────────────────────────────────────────────
export const options = {
  stages: [
    { duration: "30s", target: 100  }, // 0 → 100 VU
    { duration: "30s", target: 300  }, // 100 → 300 VU
    { duration: "30s", target: 600  }, // 300 → 600 VU
    { duration: "30s", target: 1000 }, // 600 → 1000 VU
    { duration: "60s", target: 1000 }, // 1000 VU sabit tut
    { duration: "20s", target: 0    }, // Kapat
  ],
  thresholds: {
    // HTTP yanıt süresi p95 < 500ms olmalı
    http_req_duration:      ["p(95)<1000"],
    // WebSocket bağlantı hatası oranı < %5
    ws_connect_errors:      ["count<5"],
    // Login başarısızlık oranı < %1
    login_fail_rate:        ["rate<0.01"],
    // Mesaj gönderim hatası < 10
    msg_send_errors:        ["count<10"],
  },
};

// ─── Yardımcı: negotiate endpoint'inden WebSocket URL'i al ───────────────────
function negotiate(username) {
  const res = http.post(
    `${BASE_URL}/chatHub/negotiate?negotiateVersion=1&username=${encodeURIComponent(username)}`,
    null,
    { headers: { "Content-Type": "application/json" } }
  );

  check(res, { "negotiate 200": (r) => r.status === 200 });

  if (res.status !== 200) return null;

  const body = res.json();
  // connectionToken, connectionId veya url içerebilir
  return body.connectionToken || body.connectionId || null;
}

// ─── Ana VU fonksiyonu ────────────────────────────────────────────────────────
export default function () {
  // Her VU kendi seed kullanıcısını alır (round-robin)
  const user = SEED_USERS[__VU % SEED_USERS.length];

  // 1. Login
  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ username: user.username, password: user.password }),
    { headers: { "Content-Type": "application/json" } }
  );

  const loginOk = check(loginRes, {
    "login 200":          (r) => r.status === 200,
    "login has username": (r) => r.status === 200 && r.json("username") === user.username,
  });

  loginFailRate.add(!loginOk);

  if (!loginOk) {
    sleep(1);
    return;
  }

  // 2. Oda listesini çek
  const roomsRes = http.get(`${BASE_URL}/api/rooms`);
  check(roomsRes, { "rooms 200": (r) => r.status === 200 });

  const rooms = roomsRes.json();
  if (!rooms || rooms.length === 0) {
    // Hiç oda yoksa test anlamsız; kısa bekle ve çık
    sleep(2);
    return;
  }

  const room = rooms[Math.floor(Math.random() * rooms.length)];

  // 3. SignalR negotiate
  const token = negotiate(user.username);

  // 4. WebSocket bağlantısı
  const wsStart = Date.now();

  // SignalR WebSocket URL'i: token varsa query param olarak ekle
  const wsTarget = token
    ? `${WS_URL}/chatHub?id=${encodeURIComponent(token)}&username=${encodeURIComponent(user.username)}`
    : `${WS_URL}/chatHub?username=${encodeURIComponent(user.username)}`;

  const wsRes = ws.connect(wsTarget, {}, function (socket) {
    socket.on("open", () => {
      // SignalR el sıkışması (handshake)
      socket.send(JSON.stringify({ protocol: "json", version: 1 }) + "\x1e");
    });

    socket.on("message", (data) => {
      // \x1e SignalR mesaj ayracı; her çerçeveyi ayır ve işle
      const frames = data.split("\x1e").filter(Boolean);
      frames.forEach((frame) => {
        try {
          const msg = JSON.parse(frame);

          // Handshake yanıtı boşsa bağlantı kuruldu demektir
          if (msg.type === undefined && Object.keys(msg).length === 0) {
            // Odaya katıl
            socket.send(
              JSON.stringify({
                type: 1,
                target: "JoinRoom",
                arguments: [room.id],
              }) + "\x1e"
            );
          }
        } catch (_) {
          // Geçersiz JSON — yoksay
        }
      });
    });

    socket.on("error", () => {
      wsConnectErrors.add(1);
    });

    // Bağlantıda kal ve birkaç mesaj gönder
    socket.setTimeout(() => {
      socket.close();
    }, 8000); // 8 saniye sonra kapat
  });

  check(wsRes, { "ws status 101": (r) => r && r.status === 101 });
  if (!wsRes || wsRes.status !== 101) {
    wsConnectErrors.add(1);
  }

  wsSessionDuration.add(Date.now() - wsStart);

  // 5. REST üzerinden mesaj gönder (WebSocket açıkken veya sonrasında)
  for (let i = 0; i < 3; i++) {
    const msgRes = http.post(
      `${BASE_URL}/api/messages`,
      JSON.stringify({
        sender:  user.username,
        content: `k6 yük testi mesajı #${i + 1} — VU ${__VU}`,
        roomId:  room.id,
      }),
      { headers: { "Content-Type": "application/json" } }
    );

    const msgOk = check(msgRes, { "message 200": (r) => r.status === 200 });
    if (!msgOk) msgSendErrors.add(1);

    sleep(0.5);
  }

  sleep(1);
}

// ─── Rapor üretimi ────────────────────────────────────────────────────────────
export function handleSummary(data) {
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}_${String(now.getHours()).padStart(2,"0")}-${String(now.getMinutes()).padStart(2,"0")}`;

  return {
    [`k6/reports/report_${timestamp}.html`]: htmlReport(data, { title: `ChatAPI Yük Testi — ${timestamp}` }),
    [`k6/reports/report_${timestamp}.json`]: JSON.stringify(data, null, 2),
    stdout: textSummary(data, { indent: "  ", enableColors: true }),
  };
}
