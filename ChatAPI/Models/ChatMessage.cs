namespace ChatAPI.Models;

public class ChatMessage
{
    public int Id { get; set; }
    public string Sender { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
    public string RoomName { get; set; } = string.Empty;
}
