using ChatAPI.Data;
using ChatAPI.DTOs;
using ChatAPI.Helpers;
using ChatAPI.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatAPI.Controllers;

[ApiController]
[Route("api/auth")]
public class AuthController : ControllerBase
{
    private readonly ApplicationDbContext _db;

    public AuthController(ApplicationDbContext db)
    {
        _db = db;
    }

    // POST /api/auth/register
    [HttpPost("register")]
    public async Task<IActionResult> Register([FromBody] RegisterRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "Username and password are required." });

        if (request.Username.Length < 3 || request.Username.Length > 50)
            return BadRequest(new { error = "Username must be between 3 and 50 characters." });

        if (request.Password.Length < 6)
            return BadRequest(new { error = "Password must be at least 6 characters." });

        var normalized = request.Username.Trim();

        var exists = await _db.AppUsers.AnyAsync(u => u.Username.ToLower() == normalized.ToLower());
        if (exists)
            return Conflict(new { error = "This username is already taken." });

        var user = new AppUser
        {
            Username = normalized,
            PasswordHash = PasswordHelper.Hash(request.Password)
        };

        _db.AppUsers.Add(user);
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            return Conflict(new { error = "This username is already taken." });
        }

        return Ok(new { username = user.Username });
    }

    // POST /api/auth/login
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Username) || string.IsNullOrWhiteSpace(request.Password))
            return BadRequest(new { error = "Username and password are required." });

        var normalized = request.Username.Trim();
        var user = await _db.AppUsers
            .FirstOrDefaultAsync(u => u.Username.ToLower() == normalized.ToLower());

        if (user == null || !PasswordHelper.Verify(request.Password, user.PasswordHash))
            return Unauthorized(new { error = "Invalid username or password." });

        return Ok(new { username = user.Username });
    }
}
