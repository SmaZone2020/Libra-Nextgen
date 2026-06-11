namespace LibraNextgen.Agent.Core;

public class ConfigManager
{
    public string ServerUrl { get; set; } = "http://127.0.0.1:5270";
    public string RegisterPath { get; set; } = "/api/beacon/register";
    public string HeartbeatPath { get; set; } = "/api/beacon/heartbeat";
    public string ResultPath { get; set; } = "/api/beacon/result";
    public string WebSocketPath { get; set; } = "/ws/agent";
    public int HeartbeatIntervalMs { get; set; } = 30_000;
    public double JitterPercent { get; set; } = 0.2;

    public static ConfigManager Load(string[] args)
    {
        var config = new ConfigManager();

        if (!string.IsNullOrEmpty(BuildDefaults.ServerUrl))
            config.ServerUrl = BuildDefaults.ServerUrl;

        for (int i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--server" when i + 1 < args.Length:
                    config.ServerUrl = args[++i];
                    break;
                case "--register" when i + 1 < args.Length:
                    config.RegisterPath = args[++i];
                    break;
                case "--heartbeat" when i + 1 < args.Length:
                    config.HeartbeatPath = args[++i];
                    break;
                case "--result" when i + 1 < args.Length:
                    config.ResultPath = args[++i];
                    break;
                case "--ws" when i + 1 < args.Length:
                    config.WebSocketPath = args[++i];
                    break;
            }
        }

        return config;
    }

    public string GetRegisterUrl() => $"{ServerUrl}{RegisterPath}";
    public string GetHeartbeatUrl() => $"{ServerUrl}{HeartbeatPath}";
    public string GetResultUrl() => $"{ServerUrl}{ResultPath}";
    public string GetWebSocketUrl() => $"ws://{new Uri(ServerUrl).Authority}{WebSocketPath}";

    public int GetJitteredInterval()
    {
        var jitter = (int)(HeartbeatIntervalMs * JitterPercent * (Random.Shared.NextDouble() * 2 - 1));
        return HeartbeatIntervalMs + jitter;
    }
}
