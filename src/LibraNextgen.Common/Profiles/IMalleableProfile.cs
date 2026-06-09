namespace LibraNextgen.Common.Profiles;

/// <summary>
/// Defines how Agent traffic is shaped to evade detection.
/// Implementations control URL paths, HTTP headers, and payload encoding
/// to match legitimate API traffic patterns.
/// </summary>
public interface IMalleableProfile
{
    string Name { get; }
    string Description { get; }

    string GetRegisterUrl(string baseUrl);
    string GetHeartbeatUrl(string baseUrl);
    string GetResultUrl(string baseUrl);
    string GetWebSocketUrl(string baseUrl);

    Dictionary<string, string> GetRequestHeaders();
    string GetUserAgent();

    string EncodePayload(byte[] data);
    byte[] DecodePayload(string encoded);

    int HeartbeatIntervalSeconds { get; }
    double JitterPercent { get; }
}
