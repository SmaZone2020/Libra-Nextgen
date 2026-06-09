using System.Text.Json;
using System.Text.Json.Serialization;

namespace LibraNextgen.Common.Protocol;

public class WebSocketMessage
{
    [JsonPropertyName("type")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("channel")]
    public string Channel { get; set; } = string.Empty;

    [JsonPropertyName("data")]
    public JsonElement? Data { get; set; }

    [JsonPropertyName("ts")]
    public long Timestamp { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    public string ToJson()
    {
        return JsonSerializer.Serialize(this, WsJsonContext.Default.WebSocketMessage);
    }

    public static WebSocketMessage? FromJson(string json)
    {
        return JsonSerializer.Deserialize(json, WsJsonContext.Default.WebSocketMessage);
    }
}

/// <summary>
/// Predefined WebSocket message types.
/// </summary>
public static class WsMessageType
{
    public const string AgentOnline = "agent.online";
    public const string AgentOffline = "agent.offline";
    public const string TaskCreated = "task.created";
    public const string TaskUpdated = "task.updated";
    public const string ShellInput = "shell.input";
    public const string ShellOutput = "shell.output";
    public const string ShellLockAcquired = "shell.lock.acquired";
    public const string ShellLockReleased = "shell.lock.released";
    public const string ShellObserverJoined = "shell.observer.joined";
}

[JsonSerializable(typeof(WebSocketMessage))]
internal partial class WsJsonContext : JsonSerializerContext
{
}
