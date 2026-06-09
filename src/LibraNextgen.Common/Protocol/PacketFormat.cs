using System.Text.Json;
using System.Text.Json.Serialization;

namespace LibraNextgen.Common.Protocol;

public class PacketEnvelope
{
    [JsonPropertyName("v")]
    public int Version { get; set; } = 1;

    [JsonPropertyName("ts")]
    public long Timestamp { get; set; } = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

    [JsonPropertyName("mid")]
    public string MessageId { get; set; } = Guid.NewGuid().ToString("N");

    [JsonPropertyName("t")]
    public string Type { get; set; } = string.Empty;

    [JsonPropertyName("p")]
    public string Payload { get; set; } = string.Empty;

    [JsonPropertyName("s")]
    public string? Signature { get; set; }

    public string ToJson()
    {
        return JsonSerializer.Serialize(this, JsonContext.Default.PacketEnvelope);
    }

    public static PacketEnvelope? FromJson(string json)
    {
        return JsonSerializer.Deserialize(json, JsonContext.Default.PacketEnvelope);
    }
}

[JsonSerializable(typeof(PacketEnvelope))]
internal partial class JsonContext : JsonSerializerContext
{
}
