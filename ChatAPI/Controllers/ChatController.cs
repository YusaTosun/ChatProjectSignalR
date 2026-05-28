using ChatAPI.Data;
using ChatAPI.DTOs;
using ChatAPI.Hubs;
using ChatAPI.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatAPI.Controllers;

[ApiController]
[Route("api/messages")]
public class ChatController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly IHubContext<ChatHub> _hubContext;
    private readonly ILogger<ChatController> _logger;

    public ChatController(ApplicationDbContext db, IHubContext<ChatHub> hubContext, ILogger<ChatController> logger)
    {
        _db = db;
        _hubContext = hubContext;
        _logger = logger;
    }

    // POST /api/messages
    [HttpPost]
    public async Task<IActionResult> SendMessage([FromBody] SendMessageRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Sender) ||
            string.IsNullOrWhiteSpace(request.Content) ||
            string.IsNullOrWhiteSpace(request.RoomName))
        {
            return BadRequest(new { error = "Sender, Content, and RoomName are required." });
        }

        var message = new ChatMessage
        {
            Sender = request.Sender,
            Content = request.Content,
            Timestamp = DateTime.UtcNow,
            RoomName = request.RoomName
        };

        _db.Messages.Add(message);
        await _db.SaveChangesAsync();

        var payload = new
        {
            id = message.Id,
            sender = message.Sender,
            content = message.Content,
            timestamp = message.Timestamp,
            roomName = message.RoomName
        };

        await _hubContext.Clients.Group(request.RoomName).SendAsync("ReceiveMessage", payload);

        _logger.LogInformation("Message #{Id} saved and broadcast to room '{Room}'", message.Id, message.RoomName);

        return Ok(payload);
    }

    // GET /api/messages/{roomName}
    [HttpGet("{roomName}")]
    public async Task<IActionResult> GetMessages(string roomName)
    {
        var messages = await _db.Messages
            .Where(m => m.RoomName == roomName)
            .OrderBy(m => m.Timestamp)
            .Select(m => new
            {
                id = m.Id,
                sender = m.Sender,
                content = m.Content,
                timestamp = m.Timestamp,
                roomName = m.RoomName
            })
            .ToListAsync();

        return Ok(messages);
    }
}
