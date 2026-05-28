namespace ChatAPI.Models;

public class AppUser
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Username { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Presence
    public bool IsOnline { get; set; } = false;
    public string? ConnectionId { get; set; }
    public DateTime? LastSeenAt { get; set; }
}
