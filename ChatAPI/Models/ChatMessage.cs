namespace ChatAPI.Models;

public class ChatMessage
{
    public int Id { get; set; }
    public string Sender { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public Guid RoomId { get; set; }
    public ChatRoom Room { get; set; } = null!;
    public string? MediaUrl { get; set; }
    public string? MediaType { get; set; }  // "image" | "video"
}
