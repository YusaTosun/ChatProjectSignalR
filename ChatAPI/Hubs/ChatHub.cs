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
        var username = Context.GetHttpContext()?.Request.Query["username"].ToString() ?? "Anonymous";

        var existing = await _db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (existing != null)
        {
            existing.ConnectionId = Context.ConnectionId;
        }
        else
        {
            _db.Users.Add(new User
            {
                Id = Guid.NewGuid(),
                Username = username,
                ConnectionId = Context.ConnectionId
            });
        }

        await _db.SaveChangesAsync();

        var activeUsers = await _db.Users.Select(u => u.Username).ToListAsync();
        await Clients.All.SendAsync("UpdateUsers", activeUsers);

        _logger.LogInformation("Connected: {ConnectionId} as {Username}", Context.ConnectionId, username);

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.ConnectionId == Context.ConnectionId);
        if (user != null)
        {
            _db.Users.Remove(user);
            await _db.SaveChangesAsync();
        }

        var activeUsers = await _db.Users.Select(u => u.Username).ToListAsync();
        await Clients.All.SendAsync("UpdateUsers", activeUsers);

        _logger.LogInformation("Disconnected: {ConnectionId}", Context.ConnectionId);

        await base.OnDisconnectedAsync(exception);
    }

    public async Task JoinRoom(string roomName)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, roomName);
        _logger.LogInformation("{ConnectionId} joined room: {RoomName}", Context.ConnectionId, roomName);
    }

    public async Task LeaveRoom(string roomName)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, roomName);
        _logger.LogInformation("{ConnectionId} left room: {RoomName}", Context.ConnectionId, roomName);
    }
}
