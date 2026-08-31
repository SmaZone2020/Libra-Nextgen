using LibraNextgen.Common.Profiles;

namespace LibraNextgen.Service.Profiles;

/// <summary>
/// Declarative profile backed by a persisted <see cref="MalleableProfileConfig"/>.
/// Replaces the hardcoded <see cref="DefaultProfile"/> once an operator activates
/// a custom profile.
/// </summary>
public class ConfigurableProfile : IMalleableProfile
{
    private readonly MalleableProfileConfig _config;

    public ConfigurableProfile(MalleableProfileConfig config)
    {
        _config = config;
    }

    public string Name => _config.Name;
    public string Description => _config.Description;
    public int HeartbeatIntervalSeconds => _config.HeartbeatIntervalSeconds;
    public double JitterPercent => _config.JitterPercent;

    public MalleableProfileConfig Config => _config;

    public string GetRegisterUrl(string baseUrl) => _config.RegisterPath;
    public string GetHeartbeatUrl(string baseUrl) => _config.HeartbeatPath;
    public string GetResultUrl(string baseUrl) => _config.ResultPath;
    public string GetWebSocketUrl(string baseUrl) => _config.WebSocketPath;

    public Dictionary<string, string> GetRequestHeaders() => new(_config.CustomHeaders);
    public string GetUserAgent() => _config.UserAgent;

    public string EncodePayload(byte[] data) => Convert.ToBase64String(data);
    public byte[] DecodePayload(string encoded) => Convert.FromBase64String(encoded);
}
