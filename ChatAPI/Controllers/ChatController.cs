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
        if (string.IsNullOrWhiteSpace(request.Sender) || string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { error = "Sender and Content are required." });

        var roomExists = await _db.ChatRooms.AnyAsync(r => r.Id == request.RoomId);
        if (!roomExists)
            return BadRequest(new { error = "Room not found." });

        var message = new ChatMessage
        {
            Sender = request.Sender,
            Content = request.Content,
            Timestamp = DateTime.UtcNow,
            RoomId = request.RoomId
        };

        _db.Messages.Add(message);
        await _db.SaveChangesAsync();

        var payload = new
        {
            id = message.Id,
            sender = message.Sender,
            content = message.Content,
            timestamp = message.Timestamp,
            roomId = message.RoomId
        };

        await _hubContext.Clients.Group(request.RoomId.ToString()).SendAsync("ReceiveMessage", payload);

        _logger.LogInformation("Message #{Id} saved and broadcast to room '{RoomId}'", message.Id, message.RoomId);

        return Ok(payload);
    }

    // GET /api/messages/{roomId}
    [HttpGet("{roomId:guid}")]
    public async Task<IActionResult> GetMessages(Guid roomId)
    {
        var roomExists = await _db.ChatRooms.AnyAsync(r => r.Id == roomId);
        if (!roomExists)
            return NotFound(new { error = "Room not found." });

        var messages = await _db.Messages
            .Where(m => m.RoomId == roomId)
            .OrderBy(m => m.Timestamp)
            .Select(m => new
            {
                id = m.Id,
                sender = m.Sender,
                content = m.Content,
                timestamp = m.Timestamp,
                roomId = m.RoomId
            })
            .ToListAsync();

        return Ok(messages);
    }
}
