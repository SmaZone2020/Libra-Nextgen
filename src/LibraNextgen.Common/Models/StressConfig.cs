namespace LibraNextgen.Common.Models;

public class StressConfig
{
    public string CampaignId { get; set; } = string.Empty;
    public string TargetHost { get; set; } = string.Empty;
    public int TargetPort { get; set; }
    public List<string> Methods { get; set; } = new();
    public int DurationSeconds { get; set; }
    public int ThreadsPerAgent { get; set; } = 100;
    public int PacketSize { get; set; } = 1024;
    public int MaxConnections { get; set; } = 500;
    public string HttpPath { get; set; } = "/";
}
