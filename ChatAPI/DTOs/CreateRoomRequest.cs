namespace ChatAPI.DTOs;

public class CreateRoomRequest
{
    public string Name { get; set; } = string.Empty;
    public Guid CreatedById { get; set; }
}
