using ChatAPI.Data;
using ChatAPI.Models;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatAPI.Hubs;

public class ChatHub : Hub
{
    private readonly ApplicationDbContext _db;
    private readonly ILogger<ChatHub> _logger;

    public ChatHub(ApplicationDbContext db, ILogger<ChatHub> logger)
    {
        _db = db;
        _logger = logger;
    }

    public override async Task OnConnectedAsync()
    {
        var username = Context.GetHttpContext()?.Request.Query["username"].ToString();

        if (!string.IsNullOrWhiteSpace(username))
        {
            var appUser = await _db.AppUsers
                .FirstOrDefaultAsync(u => u.Username == username);

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

            var rooms = await GetRoomListAsync();

            // Sadece yeni bağlanan kullanıcıya tam liste gönder;
            // diğerlerine yalnızca yeni kullanıcının adını bildir (N×N broadcast önlenir)
            await Task.WhenAll(
                Clients.Caller.SendAsync("UpdateUsers", onlineUsers),
                Clients.Caller.SendAsync("UpdateRooms", rooms),
                Clients.Others.SendAsync("UserConnected", username)
            );
        }
        else
        {
            var onlineUsers = await _db.AppUsers
                .Where(u => u.IsOnline)
                .Select(u => u.Username)
                .ToListAsync();

            var rooms = await GetRoomListAsync();
            await Task.WhenAll(
                Clients.Caller.SendAsync("UpdateUsers", onlineUsers),
                Clients.Caller.SendAsync("UpdateRooms", rooms)
            );
        }

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
            var username = appUser.Username;
            appUser.IsOnline = false;
            appUser.ConnectionId = null;
            appUser.LastSeenAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();

            await Clients.All.SendAsync("UserDisconnected", username);
        }

        _logger.LogInformation("Disconnected: {ConnectionId}", Context.ConnectionId);
        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(Guid roomId)
    {
        var room = await _db.ChatRooms.FindAsync(roomId);
        if (room == null) return;

        await Groups.AddToGroupAsync(Context.ConnectionId, roomId.ToString());
        _logger.LogInformation("{ConnectionId} joined room: {RoomId}", Context.ConnectionId, roomId);
    }

    public async Task LeaveRoom(Guid roomId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomId.ToString());
        _logger.LogInformation("{ConnectionId} left room: {RoomId}", Context.ConnectionId, roomId);

        var username = Context.GetHttpContext()?.Request.Query["username"].ToString();
        if (!string.IsNullOrWhiteSpace(username))
            await Clients.OthersInGroup(roomId.ToString()).SendAsync("UserStoppedTyping", username);
    }

    public async Task StartTyping(Guid roomId)
    {
        var username = Context.GetHttpContext()?.Request.Query["username"].ToString();
        if (string.IsNullOrWhiteSpace(username)) return;

        await Clients.OthersInGroup(roomId.ToString()).SendAsync("UserTyping", username);
    }

    public async Task StopTyping(Guid roomId)
    {
        var username = Context.GetHttpContext()?.Request.Query["username"].ToString();
        if (string.IsNullOrWhiteSpace(username)) return;

        await Clients.OthersInGroup(roomId.ToString()).SendAsync("UserStoppedTyping", username);
    }

    private async Task<object[]> GetRoomListAsync() =>
        await _db.ChatRooms
            .Include(r => r.CreatedBy)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new
            {
                id = r.Id,
                name = r.Name,
                createdBy = r.CreatedBy.Username,
                createdAt = r.CreatedAt
            })
            .Cast<object>()
            .ToArrayAsync();
}
