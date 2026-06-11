using System.Text.Json.Serialization;

namespace LibraNextgen.Common.Models;

public class StressTestCampaign
{
    [JsonPropertyName("id")]
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];

    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("targetHost")]
    public string TargetHost { get; set; } = string.Empty;

    [JsonPropertyName("targetPort")]
    public int TargetPort { get; set; }

    [JsonPropertyName("methods")]
    public List<string> Methods { get; set; } = new();

    [JsonPropertyName("agentIds")]
    public List<string> AgentIds { get; set; } = new();

    [JsonPropertyName("durationSeconds")]
    public int DurationSeconds { get; set; }

    [JsonPropertyName("continueAfterClose")]
    public bool ContinueAfterClose { get; set; } = true;

    [JsonPropertyName("threadsPerAgent")]
    public int ThreadsPerAgent { get; set; } = 100;

    [JsonPropertyName("packetSize")]
    public int PacketSize { get; set; } = 1024;

    [JsonPropertyName("createdBy")]
    public string CreatedBy { get; set; } = string.Empty;

    [JsonPropertyName("createdAt")]
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    [JsonPropertyName("status")]
    public CampaignStatus Status { get; set; } = CampaignStatus.Running;
}

public class StressAgentStatus
{
    [JsonPropertyName("agentId")]
    public string AgentId { get; set; } = string.Empty;

    [JsonPropertyName("hostname")]
    public string Hostname { get; set; } = string.Empty;

    [JsonPropertyName("packetsSent")]
    public long PacketsSent { get; set; }

    [JsonPropertyName("bytesSent")]
    public long BytesSent { get; set; }

    [JsonPropertyName("connectionsOpen")]
    public int ConnectionsOpen { get; set; }

    [JsonPropertyName("mbps")]
    public double Mbps { get; set; }

    [JsonPropertyName("lastReport")]
    public DateTime LastReport { get; set; } = DateTime.UtcNow;
}

public class StressStartRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("targetHost")]
    public string TargetHost { get; set; } = string.Empty;

    [JsonPropertyName("targetPort")]
    public int TargetPort { get; set; }

    [JsonPropertyName("methods")]
    public List<string> Methods { get; set; } = new();

    [JsonPropertyName("agentIds")]
    public List<string> AgentIds { get; set; } = new();

    [JsonPropertyName("durationSeconds")]
    public int DurationSeconds { get; set; }

    [JsonPropertyName("continueAfterClose")]
    public bool ContinueAfterClose { get; set; } = true;

    [JsonPropertyName("threadsPerAgent")]
    public int ThreadsPerAgent { get; set; } = 100;

    [JsonPropertyName("packetSize")]
    public int PacketSize { get; set; } = 1024;
}
