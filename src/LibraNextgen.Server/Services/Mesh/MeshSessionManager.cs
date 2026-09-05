using System.Collections.Concurrent;
using System.Globalization;
using System.Net.Http.Json;
using System.Text.Json;
using LibraNextgen.Common.Models;

namespace LibraNextgen.Service.Services.Mesh;

/// <summary>Live node session handed to callers that proxy to the node.</summary>
public sealed record NodeSession(
    string Token,
    DateTime ExpiresAt,
    DateTime ConnectedAt,
    string? StorageType);

/// <summary>Outcome of a node connect attempt.</summary>
public sealed record NodeConnectResult(bool Ok, string? Error, DateTime? ExpiresAt, string? StorageType)
{
    public static NodeConnectResult Success(DateTime expiresAt, string? storageType) =>
        new(true, null, expiresAt, storageType);
    public static NodeConnectResult Fail(string error) => new(false, error, null, null);
}

/// <summary>
/// Runtime sessions for connected mesh nodes. Tokens live only in memory —
/// nothing is persisted here; nodes reconnect (or re-exchange) after a
/// server restart. Credentials of record stay in the MeshNode store.
/// </summary>
public class MeshSessionManager
{
    private static readonly TimeSpan ConnectTimeout = TimeSpan.FromSeconds(15);
    /// <summary>Re-connect when the JWT is closer to expiry than this.</summary>
    private static readonly TimeSpan ExpiryMargin = TimeSpan.FromMinutes(2);

    private sealed record StoredSession(string Token, DateTime ExpiresAt, DateTime ConnectedAt, string? StorageType);

    private readonly ConcurrentDictionary<string, StoredSession> _sessions = new();
    private readonly IHttpClientFactory _http;
    private readonly ILogger<MeshSessionManager> _logger;

    public MeshSessionManager(IHttpClientFactory http, ILogger<MeshSessionManager> logger)
    {
        _http = http;
        _logger = logger;
    }

    /// <summary>Live (unexpired) session for a node, or null.</summary>
    public NodeSession? GetSession(string nodeId)
    {
        if (_sessions.TryGetValue(nodeId, out var s)
            && s.ExpiresAt > DateTime.UtcNow.Add(ExpiryMargin))
            return new NodeSession(s.Token, s.ExpiresAt, s.ConnectedAt, s.StorageType);
        return null;
    }

    public void Disconnect(string nodeId) => _sessions.TryRemove(nodeId, out _);

    /// <summary>
    /// Authenticate to the node: account login for Password nodes,
    /// key-exchange for AccessKey nodes. On success the JWT is cached
    /// in-memory until expiry.
    /// </summary>
    public async Task<NodeConnectResult> ConnectAsync(MeshNode node, string secret, CancellationToken ct = default)
    {
        try
        {
            var endpoint = node.AuthKind == MeshAuthKind.Password
                ? $"{node.Origin}/api/auth/login"
                : $"{node.Origin}/api/auth/key-exchange";

            object body = node.AuthKind == MeshAuthKind.Password
                ? new { username = node.Username, password = secret }
                : new { key = secret };

            using var client = _http.CreateClient();
            client.Timeout = ConnectTimeout;

            using var resp = await client.PostAsJsonAsync(endpoint, body, ct);
            var text = await resp.Content.ReadAsStringAsync(ct);
            if (!resp.IsSuccessStatusCode)
                return NodeConnectResult.Fail(ExtractError(text) ?? $"node returned HTTP {(int)resp.StatusCode}");

            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var token = root.TryGetProperty("token", out var t) ? t.GetString() : null;
            if (string.IsNullOrWhiteSpace(token))
                return NodeConnectResult.Fail("node response did not include a token");

            var expiresAt = DateTime.UtcNow.AddMinutes(30);
            if (root.TryGetProperty("expiresAt", out var e) && e.GetString() is { } raw
                && DateTime.TryParse(raw, CultureInfo.InvariantCulture,
                    DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out var parsed))
                expiresAt = parsed;

            // Best-effort probe of the node's store type (SQLite / MongoDB) so
            // the hub can badge each node; a failed probe never fails connect.
            var storageType = await ProbeStorageTypeAsync(client, node.Origin, token, ct);

            _sessions[node.Id] = new StoredSession(token, expiresAt, DateTime.UtcNow, storageType);
            return NodeConnectResult.Success(expiresAt, storageType);
        }
        catch (OperationCanceledException)
        {
            return NodeConnectResult.Fail("connection timed out");
        }
        catch (HttpRequestException ex)
        {
            return NodeConnectResult.Fail($"cannot reach node: {ex.Message}");
        }
        catch (JsonException)
        {
            return NodeConnectResult.Fail("node returned a malformed response");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Mesh connect failed for node {NodeId} ({Origin})", node.Id, node.Origin);
            return NodeConnectResult.Fail(ex.Message);
        }
    }

    private static string? ExtractError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var e) && e.GetString() is { Length: > 0 } msg)
                return msg;
        }
        catch (JsonException) { /* non-JSON error body */ }
        return null;
    }

    private static async Task<string?> ProbeStorageTypeAsync(
        HttpClient client, string origin, string token, CancellationToken ct)
    {
        try
        {
            using var probe = new HttpRequestMessage(HttpMethod.Get, $"{origin}/api/system/storage");
            probe.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", token);
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(8));
            using var resp = await client.SendAsync(probe, cts.Token);
            if (!resp.IsSuccessStatusCode) return null;
            var text = await resp.Content.ReadAsStringAsync(cts.Token);
            using var doc = JsonDocument.Parse(text);
            if (doc.RootElement.TryGetProperty("dbType", out var db) && db.GetString() is { } kind)
                return kind.Equals("sqlite", StringComparison.OrdinalIgnoreCase) ? "sqlite" : "mongo";
            return null;
        }
        catch (Exception)
        {
            return null; // probe is best-effort; the session itself stays valid
        }
    }
}
