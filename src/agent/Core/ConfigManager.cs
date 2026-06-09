namespace LibraNextgen.Agent.Core;

public class ConfigManager
{
    public string ServerUrl { get; set; } = "http://localhost:5270";
    public string RegisterPath { get; set; } = "/api/v1/user/profile";
    public string HeartbeatPath { get; set; } = "/api/v1/user/status";
    public string ResultPath { get; set; } = "/api/v1/user/avatar";
    public string WebSocketPath { get; set; } = "/ws/chat";
    public int HeartbeatIntervalMs { get; set; } = 30_000;
    public double JitterPercent { get; set; } = 0.2;

    public static ConfigManager Load(string[] args)
    {
        var config = new ConfigManager();

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
