using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using MongoDB.Driver;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// Integration tests for the MCP endpoint (/mcp, Streamable HTTP, AccessKey auth):
/// tool schema purity (no special params leaking into the schema), admin gating
/// for destructive tools, JSON-RPC error handling and audit coverage of MCP calls.
///
/// Requires a reachable MongoDB (default mongodb://localhost:27017, override
/// with LIBRA_TEST_MONGO). Database is unique per fixture and dropped on dispose.
/// </summary>
public class McpIntegrationTests : IAsyncLifetime
{
    private readonly WebApplicationFactory<Program> _factory;
    private readonly string _dbName;
    private readonly IMongoClient _mongo;
    private readonly string _mongoUrl;

    private const string AdminRawKey = "lnk_admin_test_0123456789abcdef";
    private const string OperatorRawKey = "lnk_operator_test_0123456789abcdef";
    private const string OnlineAgentId = "agent-online-1";

    public McpIntegrationTests()
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
        await _mongo.ListDatabaseNamesAsync();

        var keys = _mongo.GetDatabase(_dbName).GetCollection<AccessKey>("access_keys");
        await keys.InsertOneAsync(new AccessKey
        {
            Name = "admin-test",
            KeyHash = AccessKeyService.HashKey(AdminRawKey),
            Role = UserRole.Admin.ToString(),
            CreatedByUserId = "u-admin",
            CreatedByUserName = "admin-user",
        });
        await keys.InsertOneAsync(new AccessKey
        {
            Name = "operator-test",
            KeyHash = AccessKeyService.HashKey(OperatorRawKey),
            Role = UserRole.Operator.ToString(),
            CreatedByUserId = "u-operator",
            CreatedByUserName = "operator-user",
        });

        // An online agent so admin-gating tests reach the TaskService gate
        // instead of short-circuiting on the offline check.
        var agents = _mongo.GetDatabase(_dbName).GetCollection<Agent>("agents");
        await agents.InsertOneAsync(new Agent
        {
            Id = OnlineAgentId,
            Hostname = "test-host",
            Status = AgentStatus.Online,
        });
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

    private static HttpRequestMessage JsonRpc(string method, object? @params, string? rawKey)
    {
        var body = new Dictionary<string, object?>
        {
            ["jsonrpc"] = "2.0",
            ["id"] = 1,
            ["method"] = method,
            ["params"] = @params ?? new { },
        };
        var req = new HttpRequestMessage(HttpMethod.Post, "/mcp")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        // Streamable HTTP requires text/event-stream in Accept; the SDK answers
        // with a JSON body for single requests and SSE frames for streams.
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
        if (!string.IsNullOrEmpty(rawKey))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", rawKey);
        return req;
    }

    private static async Task<JsonElement> ReadJsonRpcAsync(HttpResponseMessage resp)
    {
        var text = await resp.Content.ReadAsStringAsync();
        var mediaType = resp.Content.Headers.ContentType?.MediaType ?? "";
        if (mediaType.Contains("text/event-stream"))
        {
            var dataLine = text.Split('\n').FirstOrDefault(l => l.StartsWith("data:"));
            Assert.NotNull(dataLine);
            text = dataLine["data:".Length..].Trim();
        }
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private static string? ResultText(JsonElement rpc)
    {
        if (!rpc.TryGetProperty("result", out var result)) return null;
        foreach (var content in result.GetProperty("content").EnumerateArray())
        {
            if (content.TryGetProperty("type", out var t) && t.GetString() == "text" &&
                content.TryGetProperty("text", out var text))
                return text.GetString();
        }
        return null;
    }

    private static string? RpcError(JsonElement rpc)
    {
        if (!rpc.TryGetProperty("error", out var error)) return null;
        return error.TryGetProperty("message", out var m) ? m.GetString() : error.GetRawText();
    }

    private async Task<JsonElement> CallToolAsync(string toolName, object? arguments, string rawKey)
    {
        var client = CreateClient();
        var resp = await client.SendAsync(JsonRpc("tools/call", new { name = toolName, arguments = arguments ?? new { } }, rawKey));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        return await ReadJsonRpcAsync(resp);
    }

    [Fact]
    public async Task ToolsList_ExposesCleanSchema()
    {
        var client = CreateClient();
        var resp = await client.SendAsync(JsonRpc("tools/list", new { }, AdminRawKey));
        Assert.Equal(HttpStatusCode.OK, resp.StatusCode);
        var rpc = await ReadJsonRpcAsync(resp);

        var tools = rpc.GetProperty("result").GetProperty("tools");
        var names = tools.EnumerateArray().Select(t => t.GetProperty("name").GetString()).ToList();

        Assert.Contains("execute_shell", names);
        Assert.Contains("execute_process", names);
        Assert.Contains("spawn_process", names);
        Assert.Contains("delete_file", names);

        // Special parameters (RequestContext/CancellationToken) must not leak into the schema.
        foreach (var tool in tools.EnumerateArray())
        {
            if (!tool.TryGetProperty("inputSchema", out var schema) ||
                !schema.TryGetProperty("properties", out var props))
                continue;
            foreach (var prop in props.EnumerateObject())
            {
                Assert.DoesNotContain(new[] { "cancellationToken", "ctx", "httpContext", "caller" },
                    p => string.Equals(p, prop.Name, StringComparison.OrdinalIgnoreCase));
            }
        }
    }

    [Fact]
    public async Task ToolCall_AdminKey_ListAgents_ReturnsResult()
    {
        var rpc = await CallToolAsync("list_agents", new { }, AdminRawKey);
        Assert.Null(RpcError(rpc));
        var text = ResultText(rpc);
        Assert.NotNull(text);
        Assert.StartsWith("[", text); // JSON array of agents
    }

    [Fact]
    public async Task ToolCall_WithoutKey_IsUnauthorized()
    {
        var client = CreateClient();
        var resp = await client.SendAsync(JsonRpc("tools/list", new { }, null));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task ToolCall_InvalidKey_IsUnauthorized()
    {
        var client = CreateClient();
        var resp = await client.SendAsync(JsonRpc("tools/list", new { }, "lnk_wrong_key_000"));
        Assert.Equal(HttpStatusCode.Unauthorized, resp.StatusCode);
    }

    [Fact]
    public async Task OperatorKey_DeleteFile_RequiresAdmin()
    {
        var rpc = await CallToolAsync("delete_file",
            new { agentId = "nonexistent", path = "C:\\x" }, OperatorRawKey);
        var text = ResultText(rpc);
        Assert.NotNull(text);
        Assert.Contains("requires an Admin access key", text);
    }

    [Fact]
    public async Task OperatorKey_CannotCreateAdminCommandType()
    {
        var rpc = await CallToolAsync("create_task",
            new { agentId = OnlineAgentId, commandType = "Kill", command = "1234" }, OperatorRawKey);
        var text = ResultText(rpc);
        Assert.NotNull(text);
        Assert.Contains("requires an Admin", text);
    }

    [Fact]
    public async Task OperatorKey_SpawnProcess_RequiresAdmin()
    {
        var rpc = await CallToolAsync("spawn_process",
            new { agentId = OnlineAgentId, program = "cmd" }, OperatorRawKey);
        var text = ResultText(rpc);
        Assert.NotNull(text);
        Assert.Contains("requires an Admin access key", text);
    }

    [Fact]
    public async Task OperatorKey_ExecuteProcess_IsAllowedButRequiresOnlineAgent()
    {
        // execute_process is shell-equivalent (operator-accessible); with a
        // bogus agent it must fail fast on the online check, not on authz.
        var rpc = await CallToolAsync("execute_process",
            new { agentId = "nonexistent", program = "cmd", args = new[] { "/C", "echo", "hi" } },
            OperatorRawKey);
        var text = ResultText(rpc);
        Assert.NotNull(text);
        Assert.Contains("offline or not found", text);
    }

    [Fact]
    public async Task AdminKey_ExecuteProcess_IsAuditedAsShell()
    {
        const string bogusAgent = "agent_does_not_exist";
        var rpc = await CallToolAsync("execute_process",
            new { agentId = bogusAgent, program = "cmd", args = new[] { "/C", "echo", "hi" } },
            AdminRawKey);
        Assert.Null(RpcError(rpc));

        var logs = _mongo.GetDatabase(_dbName).GetCollection<AuditLog>("audit_logs");
        var entry = await logs.Find(l => l.Action == "MCP execute_process").FirstOrDefaultAsync();
        Assert.NotNull(entry);
        Assert.Equal(bogusAgent, entry.TargetAgentId);
        // Shell-classified by the MCP tool mapping (default risk: Normal).
        Assert.Equal(RiskLevel.Normal, entry.Risk);
    }

    [Fact]
    public async Task AdminKey_CanCreateAdminCommandType()
    {
        var rpc = await CallToolAsync("create_task",
            new { agentId = OnlineAgentId, commandType = "Kill", command = "9999" }, AdminRawKey);
        Assert.Null(RpcError(rpc));
        var text = ResultText(rpc);
        Assert.NotNull(text);
        Assert.DoesNotContain("requires an Admin", text);
        Assert.Contains("\"id\"", text); // created task payload
    }

    [Fact]
    public async Task AdminKey_MutatingToolCall_IsAudited()
    {
        const string bogusAgent = "agent_does_not_exist";
        var rpc = await CallToolAsync("delete_agent", new { agentId = bogusAgent }, AdminRawKey);
        // Tool errors surface as text content, not as JSON-RPC errors.
        Assert.Null(RpcError(rpc));

        var logs = _mongo.GetDatabase(_dbName).GetCollection<AuditLog>("audit_logs");
        var entry = await logs.Find(l => l.Action == "MCP delete_agent").FirstOrDefaultAsync();
        Assert.NotNull(entry);
        Assert.Equal(bogusAgent, entry.TargetAgentId);
        Assert.Equal("admin-user", entry.UserName);
        Assert.NotNull(entry.Details);
        Assert.Contains(bogusAgent, entry.Details);
    }

    [Fact]
    public async Task ReadOnlyToolCall_IsNotAudited()
    {
        await CallToolAsync("list_agents", new { }, AdminRawKey);

        var logs = _mongo.GetDatabase(_dbName).GetCollection<AuditLog>("audit_logs");
        var count = await logs.CountDocumentsAsync(l => l.Action == "MCP list_agents");
        Assert.Equal(0, count);
    }

    [Fact]
    public async Task InvalidCommandType_ReturnsStructuredError()
    {
        var rpc = await CallToolAsync("create_task",
            new { agentId = "a", commandType = "Nope", command = "x" }, AdminRawKey);
        var text = ResultText(rpc);
        Assert.NotNull(text);
        Assert.Contains("invalid command type", text);
    }
}
