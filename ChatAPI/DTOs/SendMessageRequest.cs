namespace ChatAPI.DTOs;

public class SendMessageRequest
{
    public string Sender { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public Guid RoomId { get; set; }
    public string? MediaUrl { get; set; }
    public string? MediaType { get; set; }
}
