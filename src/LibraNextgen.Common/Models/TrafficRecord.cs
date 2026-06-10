namespace LibraNextgen.Common.Models;

public class TrafficRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string AgentId { get; set; } = string.Empty;
    public string Hostname { get; set; } = string.Empty;
    public long BytesSent { get; set; }
    public long BytesReceived { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;
}
