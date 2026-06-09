namespace LibraNextgen.Common.Models;

public class AgentTask
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string AgentId { get; set; } = string.Empty;
    public string CreatedBy { get; set; } = string.Empty;
    public CommandType CommandType { get; set; }
    public string Command { get; set; } = string.Empty;
    public string[]? Arguments { get; set; }
    public TaskStatus Status { get; set; } = TaskStatus.Pending;
    public string? Output { get; set; }
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? DispatchedAt { get; set; }
    public DateTime? CompletedAt { get; set; }
    public int TimeoutSeconds { get; set; } = 60;
}

public class TaskCreateRequest
{
    public string AgentId { get; set; } = string.Empty;
    public CommandType CommandType { get; set; }
    public string Command { get; set; } = string.Empty;
    public string[]? Arguments { get; set; }
    public int TimeoutSeconds { get; set; } = 60;
}
