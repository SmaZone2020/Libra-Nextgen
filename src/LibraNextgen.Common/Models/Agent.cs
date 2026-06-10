namespace LibraNextgen.Common.Models;

public class Agent
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Hostname { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
    public string OsVersion { get; set; } = string.Empty;
    public string Arch { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public int Pid { get; set; }
    public bool IsElevated { get; set; }
    public AgentStatus Status { get; set; } = AgentStatus.Online;
    public DateTime FirstSeen { get; set; } = DateTime.UtcNow;
    public DateTime LastSeen { get; set; } = DateTime.UtcNow;
    public int HeartbeatInterval { get; set; } = 30;
    public string? Hwid { get; set; }
    public string? PublicKey { get; set; }
    public HardwareInfo? Hardware { get; set; }
    public Dictionary<string, string> Metadata { get; set; } = new();
}


public class AgentListItem
{
    public string Id { get; set; } = string.Empty;
    public string Hostname { get; set; } = string.Empty;
    public string IpAddress { get; set; } = string.Empty;
    public string OsVersion { get; set; } = string.Empty;
    public AgentStatus Status { get; set; }
    public DateTime LastSeen { get; set; }
}

public class AgentDetail : AgentListItem
{
    public string Arch { get; set; } = string.Empty;
    public string UserName { get; set; } = string.Empty;
    public string ProcessName { get; set; } = string.Empty;
    public int Pid { get; set; }
    public bool IsElevated { get; set; }
    public string? Hwid { get; set; }
    public DateTime FirstSeen { get; set; }
    public int HeartbeatInterval { get; set; }
    public HardwareInfo? Hardware { get; set; }
    public Dictionary<string, string> Metadata { get; set; } = new();
}

