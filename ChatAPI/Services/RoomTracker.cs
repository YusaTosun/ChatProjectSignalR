namespace ChatAPI.Services;

public class RoomTracker
{
    private readonly Dictionary<string, HashSet<string>> _rooms = new();
    private readonly object _lock = new();

    public void Add(string room, string connectionId)
    {
        lock (_lock)
        {
            if (!_rooms.TryGetValue(room, out var members))
                _rooms[room] = members = [];
            members.Add(connectionId);
        }
    }

    public void Remove(string room, string connectionId)
    {
        lock (_lock)
        {
            if (!_rooms.TryGetValue(room, out var members)) return;
            members.Remove(connectionId);
            if (members.Count == 0) _rooms.Remove(room);
        }
    }

    public void RemoveConnection(string connectionId)
    {
        lock (_lock)
        {
            foreach (var room in _rooms.Keys.ToList())
            {
                _rooms[room].Remove(connectionId);
                if (_rooms[room].Count == 0) _rooms.Remove(room);
            }
        }
    }

    public IReadOnlyList<string> GetRooms()
    {
        lock (_lock)
            return [.. _rooms.Keys.Order()];
    }
}
