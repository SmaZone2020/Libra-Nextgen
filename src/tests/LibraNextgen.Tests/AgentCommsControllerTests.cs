using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Configuration;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Bson;
using MongoDB.Driver;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// Integration tests for the agent beacon contract (register → task → SSE push),
/// hosted with WebApplicationFactory against a real local MongoDB instance.
///
/// The database name is unique per fixture and dropped on dispose, so tests
/// never touch the development database.
///
/// Requires a reachable MongoDB (default mongodb://localhost:27017). Override
/// with the LIBRA_TEST_MONGO env var (e.g. the CI service container).
/// </summary>
public class AgentCommsControllerTests : IAsyncLifetime
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _dbName;
    private readonly IMongoClient _mongo;
    private readonly string _mongoUrl;

    public AgentCommsControllerTests()
    {
        _mongoUrl = Environment.GetEnvironmentVariable("LIBRA_TEST_MONGO") ?? "mongodb://localhost:27017";
        _dbName = $"libra_nextgen_test_{Guid.NewGuid():N}";

        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("MongoDB:ConnectionString", _mongoUrl);
            builder.UseSetting("MongoDB:DatabaseName", _dbName);
        });

        _mongo = new MongoClient(_mongoUrl);
    }

    public async Task InitializeAsync()
    {
        // Fail fast with a clear message when MongoDB is not reachable.
        await _mongo.ListDatabaseNamesAsync();
    }

    public async Task DisposeAsync()
    {
        try
        {
            await _mongo.DropDatabaseAsync(_dbName);
        }
        finally
        {
            await _factory.DisposeAsync();
        }
    }

    private HttpClient CreateClient() => _factory.CreateClient();

    private static (string publicKeyB64, RSA privateKey) NewAgentKeyPair()
    {
        using var rsa = RSA.Create(2048);
        var pub = Convert.ToBase64String(rsa.ExportSubjectPublicKeyInfo());
        // The private key must stay alive for decryption; export the parameters.
        var parameters = rsa.ExportParameters(true);
        var copy = RSA.Create(parameters);
        return (pub, copy);
    }

    [Fact]
    public async Task Register_ThenTask_ThenSsePush_FullBeaconLoop()
    {
        var client = CreateClient();
        var (pubKey, agentRsa) = NewAgentKeyPair();

        // 1) Register (plaintext bootstrap path — no beacon secret configured).
        var hwid = $"it-{Guid.NewGuid():N}";
        var regBody = new
        {
            hostname = "it-host",
            userName = "it-user",
            osVersion = "Windows 11 Pro 10.0.26100",
            arch = "x64",
            processName = "agent",
            pid = 12345,
            isElevated = false,
            publicKey = pubKey,
            beaconSecret = "",
            hardware = new { hwid },
            hasSessionKey = false,
        };
        var regResp = await client.PostAsJsonAsync("/api/v1/session", regBody);
        Assert.Equal(System.Net.HttpStatusCode.OK, regResp.StatusCode);

        var regJson = await regResp.Content.ReadAsStringAsync();
        using var regDoc = JsonDocument.Parse(regJson);
        var root = regDoc.RootElement;
        var agentId = root.GetProperty("agent_id").GetString();
        var sessionToken = root.GetProperty("session_token").GetString();
        var sessionKeyB64 = root.GetProperty("session_key").GetString();

        Assert.False(string.IsNullOrEmpty(agentId));
        Assert.False(string.IsNullOrEmpty(sessionToken));
        Assert.False(string.IsNullOrEmpty(sessionKeyB64));

        // 2) Recover the AES session key (RSA-OAEP-SHA256 with the agent keypair).
        var encKey = Convert.FromBase64String(sessionKeyB64!);
        var aesKey = agentRsa.Decrypt(encKey, RSAEncryptionPadding.OaepSHA256);
        Assert.Equal(32, aesKey.Length);

        // 3) Create a task for the agent (authenticated console call).
        var jwtSettings = _factory.Services.GetRequiredService<JwtSettings>();
        var (token, _) = JwtHelper.GenerateToken(
            "admin-1", "it-admin", "Admin",
            jwtSettings.Rsa, jwtSettings.Issuer, jwtSettings.Audience);

        var taskBody = new
        {
            agentId,
            commandType = "Shell",
            command = "whoami",
            arguments = Array.Empty<string>(),
            timeoutSeconds = 30,
        };
        using var taskReq = new HttpRequestMessage(HttpMethod.Post, "/api/tasks")
        {
            Content = JsonContent.Create(taskBody),
        };
        taskReq.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        var taskResp = await client.SendAsync(taskReq);
        Assert.Equal(System.Net.HttpStatusCode.Created, taskResp.StatusCode);

        var taskJson = await taskResp.Content.ReadAsStringAsync();
        using var taskDoc = JsonDocument.Parse(taskJson);
        var taskId = taskDoc.RootElement.GetProperty("id").GetString();
        Assert.False(string.IsNullOrEmpty(taskId));

        // 4) Open the SSE task stream and read the pushed (encrypted) event.
        using var sseReq = new HttpRequestMessage(
            HttpMethod.Get, $"/api/beacon/events?channel={Uri.EscapeDataString(sessionToken!)}");
        using var sseResp = await client.SendAsync(sseReq, HttpCompletionOption.ResponseHeadersRead);
        Assert.Equal(System.Net.HttpStatusCode.OK, sseResp.StatusCode);
        Assert.Contains("text/event-stream", sseResp.Content.Headers.ContentType?.ToString() ?? "");

        var (op, dataRaw) = await ReadFirstSseEvent(sseResp, aesKey);
        Assert.Equal("task", op);
        using var dataDoc = JsonDocument.Parse(dataRaw);
        Assert.Equal(taskId, dataDoc.RootElement.GetProperty("id").GetString());
    }

    [Fact]
    public async Task Register_DuplicateHwid_UpsertsSameAgent()
    {
        var client = CreateClient();
        var (pubKey, _) = NewAgentKeyPair();
        var hwid = $"it-dup-{Guid.NewGuid():N}";

        var regBody = new
        {
            hostname = "dup-host",
            userName = "dup-user",
            osVersion = "os",
            arch = "x64",
            processName = "agent",
            pid = 1,
            isElevated = false,
            publicKey = pubKey,
            beaconSecret = "",
            hardware = new { hwid },
            hasSessionKey = false,
        };

        var r1 = await client.PostAsJsonAsync("/api/v1/session", regBody);
        var j1 = await r1.Content.ReadAsStringAsync();
        var id1 = JsonDocument.Parse(j1).RootElement.GetProperty("agent_id").GetString();

        var r2 = await client.PostAsJsonAsync("/api/v1/session", regBody);
        var j2 = await r2.Content.ReadAsStringAsync();
        var id2 = JsonDocument.Parse(j2).RootElement.GetProperty("agent_id").GetString();

        Assert.Equal(System.Net.HttpStatusCode.OK, r1.StatusCode);
        Assert.Equal(System.Net.HttpStatusCode.OK, r2.StatusCode);
        Assert.Equal(id1, id2); // same HWID → upsert, not a new agent
    }

    private static async Task<(string op, string data)> ReadFirstSseEvent(
        HttpResponseMessage sseResp, byte[] aesKey)
    {
        using var stream = await sseResp.Content.ReadAsStreamAsync();
        using var reader = new StreamReader(stream, Encoding.UTF8);

        var readUntil = DateTime.UtcNow.AddSeconds(15);
        string? line;
        while ((line = await reader.ReadLineAsync()) != null)
        {
            if (line.StartsWith("data:") && line.Length > 6)
            {
                var b64 = line["data:".Length..].Trim();
                var plain = CryptoHelper.DecryptPayload(b64, aesKey);
                using var doc = JsonDocument.Parse(plain);
                var op = doc.RootElement.GetProperty("op").GetString();
                var data = doc.RootElement.GetProperty("data").GetRawText();
                return (op ?? string.Empty, data);
            }
            if (DateTime.UtcNow > readUntil)
                break;
        }
        throw new TimeoutException("No SSE event received within 15s");
    }
}
