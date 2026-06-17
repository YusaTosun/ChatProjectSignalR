# Yapılacaklar Listesi

## Yüksek Öncelik

### Güvenlik
- [ ] **JWT Authentication** — şu an username query string ile geçiyor, kimlik doğrulama yok. Hub ve API endpoint'lere `[Authorize]` + JWT token eklenmeli
- [ ] **Mesaj validation** — gelen mesaj boyutu ve içerik filtresi yok; upload'larda MIME type kontrolü sunucu tarafında yapılmalı

### UX / Özellik
- [ ] **Okundu bilgisi (read receipts)** — mesaj okunduğunda ✓✓ göstermek için `MessageRead` tablosu + SignalR event
- [ ] **Mesaj düzenleme & silme** — `EditMessage` / `DeleteMessage` hub metotları + UI butonu
- [ ] **Direkt mesajlaşma (DM)** — şu an sadece room var; kullanıcılar arası 1-1 chat için özel room mantığı veya ayrı `DirectMessage` modeli

---

## Orta Öncelik

### Performans
- [ ] **Redis backplane** — birden fazla sunucu instance'ında SignalR mesajlarını senkronize etmek için (scale-out)
- [ ] **Cursor tabanlı sayfalama** — `/api/chat/{roomId}/messages` şu an tüm mesajları çekiyor; infinite scroll için `cursor` + `limit` parametresi
- [ ] **Output caching** — oda listesi gibi sık sorgulanan verileri cache'lemek

### Bildirimler
- [ ] **Mention (@kullanıcı)** — içerikte `@username` parse edip o kişiye bildirim gönder
- [ ] **Browser push notifications** — Service Worker + Web Push API ile sekme kapalıyken bildirim

---

## Küçük İyileştirmeler

- [x] **Emoji picker** — mesaj alanına emoji butonu ekle
- [ ] **Kod bloğu rendering** — backtick ile yazılan mesajlarda syntax highlighting (highlight.js veya Prism)
- [x] **Dark mode** — CSS variables zaten var, toggle eklenebilir
- [ ] **Oda yönetimi** — oda silme, düzenleme, üye ekleme/çıkarma
- [ ] **Mesaj arama** — oda içinde full-text search

---

## Tamamlananlar

- [x] SignalR ile gerçek zamanlı mesajlaşma
- [x] Oda (room) sistemi
- [x] Kullanıcı presence (online/offline) takibi
- [x] Yazıyor... (typing indicator)
- [x] Dosya/medya gönderimi (resim, video)
- [x] Yük testi (k6) ve performans iyileştirmeleri
- [x] Bağımsız isteklerin asenkron hale getirilmesi
