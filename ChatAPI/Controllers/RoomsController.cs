using ChatAPI.Data;
using ChatAPI.DTOs;
using ChatAPI.Hubs;
using ChatAPI.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatAPI.Controllers;

[ApiController]
[Route("api/rooms")]
public class RoomsController : ControllerBase
{
    private readonly ApplicationDbContext _db;
    private readonly IHubContext<ChatHub> _hubContext;

    public RoomsController(ApplicationDbContext db, IHubContext<ChatHub> hubContext)
    {
        _db = db;
        _hubContext = hubContext;
    }

    // GET /api/rooms
    [HttpGet]
    public async Task<IActionResult> GetRooms()
    {
        var rooms = await _db.ChatRooms
            .Include(r => r.CreatedBy)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new
            {
                id = r.Id,
                name = r.Name,
                createdBy = r.CreatedBy.Username,
                createdAt = r.CreatedAt
            })
            .ToListAsync();

        return Ok(rooms);
    }

    // POST /api/rooms
    [HttpPost]
    public async Task<IActionResult> CreateRoom([FromBody] CreateRoomRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required." });

        var user = await _db.AppUsers.FindAsync(request.CreatedById);
        if (user == null)
            return BadRequest(new { error = "User not found." });

        var room = new ChatRoom
        {
            Name = request.Name.Trim(),
            CreatedById = request.CreatedById
        };

        _db.ChatRooms.Add(room);
        await _db.SaveChangesAsync();

        var payload = new
        {
            id = room.Id,
            name = room.Name,
            createdBy = user.Username,
            createdAt = room.CreatedAt
        };

        await _hubContext.Clients.All.SendAsync("RoomCreated", payload);

        return Ok(payload);
    }
}
