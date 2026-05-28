using ChatAPI.Data;
using ChatAPI.Models;
using ChatAPI.Services;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatAPI.Hubs;

public class ChatHub : Hub
{
    private readonly ApplicationDbContext _db;
    private readonly RoomTracker _rooms;
    private readonly ILogger<ChatHub> _logger;

    public ChatHub(ApplicationDbContext db, RoomTracker rooms, ILogger<ChatHub> logger)
    {
        _db = db;
        _rooms = rooms;
        _logger = logger;
    }

    public override async Task OnConnectedAsync()
    {
        var username = Context.GetHttpContext()?.Request.Query["username"].ToString();

        if (!string.IsNullOrWhiteSpace(username))
        {
            var appUser = await _db.AppUsers
                .FirstOrDefaultAsync(u => u.Username.ToLower() == username.ToLower());

            if (appUser != null)
            {
                appUser.IsOnline = true;
                appUser.ConnectionId = Context.ConnectionId;
                await _db.SaveChangesAsync();
            }

            var onlineUsers = await _db.AppUsers
                .Where(u => u.IsOnline)
                .Select(u => u.Username)
                .ToListAsync();

            await Clients.All.SendAsync("UpdateUsers", onlineUsers);
        }
        else
        {
            // Gözlemci: sadece mevcut durumu gönder
            var onlineUsers = await _db.AppUsers
                .Where(u => u.IsOnline)
                .Select(u => u.Username)
                .ToListAsync();

            await Clients.Caller.SendAsync("UpdateUsers", onlineUsers);
        }

        await Clients.Caller.SendAsync("UpdateRooms", _rooms.GetRooms());

        _logger.LogInformation("Connected: {ConnectionId} ({Mode})",
            Context.ConnectionId, string.IsNullOrWhiteSpace(username) ? "observer" : username);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var appUser = await _db.AppUsers
            .FirstOrDefaultAsync(u => u.ConnectionId == Context.ConnectionId);

        if (appUser != null)
        {
            appUser.IsOnline = false;
            appUser.ConnectionId = null;
            appUser.LastSeenAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            var onlineUsers = await _db.AppUsers
                .Where(u => u.IsOnline)
                .Select(u => u.Username)
                .ToListAsync();

            await Clients.All.SendAsync("UpdateUsers", onlineUsers);
        }

        _rooms.RemoveConnection(Context.ConnectionId);
        await Clients.All.SendAsync("UpdateRooms", _rooms.GetRooms());

        _logger.LogInformation("Disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(string roomName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        _rooms.Add(roomName, Context.ConnectionId);
        await Clients.All.SendAsync("UpdateRooms", _rooms.GetRooms());
        _logger.LogInformation("{ConnectionId} joined room: {RoomName}", Context.ConnectionId, roomName);
    }

    public async Task LeaveRoom(string roomName)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomName);
        _rooms.Remove(roomName, Context.ConnectionId);
        await Clients.All.SendAsync("UpdateRooms", _rooms.GetRooms());
        _logger.LogInformation("{ConnectionId} left room: {RoomName}", Context.ConnectionId, roomName);
    }
}
