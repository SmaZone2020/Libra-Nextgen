using System.ComponentModel;
using System.Net.Http.Headers;
using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services.Mesh;
using ModelContextProtocol.Server;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// Read-only mesh visibility tools: let Justitia inspect registered server
/// nodes and the agents running on them, so she can answer questions like
/// "Node A 有 4 台 Agent" without touching node credentials. Connect/disconnect
/// stays an Admin console action — the tools never mutate node state.
/// </summary>
[McpServerToolType]
public sealed class MeshTools
{
    private static readonly TimeSpan FetchTimeout = TimeSpan.FromSeconds(15);

    [McpServerTool]
    [Description("列出本机已注册的服务器节点：名称/地址/存储类型(SQLite 或 MongoDB)/连接状态/在线设备数。连接需先在节点页操作；设备明细用 mesh_node_agents。")]
    public static async Task<string> mesh_list_nodes(
        MeshNodeService nodes,
        MeshSessionManager sessions,
        IHttpClientFactory http,
        CancellationToken ct = default)
    {
        var all = await nodes.ListAsync(ct);
        var rows = new List<object>();

        foreach (var node in all.Take(20))
        {
            var session = sessions.GetSession(node.Id);
            int? online = null;
            if (session is not null)
            {
                online = await CountOnlineAsync(node, session.Token, http, ct);
            }

            rows.Add(new
            {
                id = node.Id,
                name = node.Name,
                origin = node.Origin,
                storageType = session?.StorageType ?? "unknown",
                connected = session != null,
                onlineAgents = online,
                lastError = node.LastError,
            });
        }

        return McpUtils.Ok(rows);
    }

    [McpServerTool]
    [Description("查询指定节点（用 mesh_list_nodes 输出的名称或 id）上在线的设备：hostname/IP/系统/账号。节点必须已连接；只读，不向设备下发任何操作。")]
    public static async Task<string> mesh_node_agents(
        MeshNodeService nodes,
        MeshSessionManager sessions,
        IHttpClientFactory http,
        [Description("节点名称或节点 id")] string node,
        CancellationToken ct = default)
    {
        var key = (node ?? "").Trim();
        var all = await nodes.ListAsync(ct);
        var match = all.FirstOrDefault(n => n.Id == key || n.Name.Equals(key, StringComparison.OrdinalIgnoreCase));
        if (match is null)
            return McpUtils.Error($"node '{key}' not found (see mesh_list_nodes)");

        var session = sessions.GetSession(match.Id);
        if (session is null)
            return McpUtils.Error($"node '{match.Name}' is not connected");

        try
        {
            var agents = await FetchAgentsAsync(match, session.Token, http, ct);
            return McpUtils.Ok(new
            {
                nodeId = match.Id,
                nodeName = match.Name,
                storageType = session.StorageType,
                total = agents.Count,
                agents = agents.Take(100),
            });
        }
        catch (Exception ex)
        {
            return McpUtils.Error($"failed to reach node '{match.Name}': {ex.Message}");
        }
    }

    private static async Task<int> CountOnlineAsync(
        MeshNode node, string token, IHttpClientFactory http, CancellationToken ct)
    {
        try
        {
            return (await FetchAgentsAsync(node, token, http, ct)).Count;
        }
        catch
        {
            return -1; // reachable node but the poll failed — report unknown
        }
    }

    private static async Task<List<object>> FetchAgentsAsync(
        MeshNode node, string token, IHttpClientFactory http, CancellationToken ct)
    {
        using var client = http.CreateClient();
        client.Timeout = FetchTimeout;

        using var req = new HttpRequestMessage(HttpMethod.Get, $"{node.Origin}/api/agents?page=1&pageSize=500");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        req.Headers.TryAddWithoutValidation("Accept", "application/json");

        using var resp = await client.SendAsync(req, ct);
        resp.EnsureSuccessStatusCode();
        var text = await resp.Content.ReadAsStringAsync(ct);

        var rows = new List<object>();
        using var doc = JsonDocument.Parse(text);
        if (!doc.RootElement.TryGetProperty("agents", out var agents) || agents.ValueKind != JsonValueKind.Array)
            return rows;

        foreach (var item in agents.EnumerateArray())
        {
            string? Str(string name)
            {
                return item.TryGetProperty(name, out var p) ? p.GetString() : null;
            }

            var status = Str("status") ?? "";
            if (!string.Equals(status, "Online", StringComparison.OrdinalIgnoreCase)) continue;

            string? region = null;
            if (item.TryGetProperty("geo", out var geo) && geo.ValueKind == JsonValueKind.Object
                && geo.TryGetProperty("region", out var regionProp))
                region = regionProp.GetString();

            rows.Add(new
            {
                id = Str("id"),
                hostname = Str("hostname"),
                ip = Str("ipAddress"),
                os = Str("osVersion"),
                user = Str("userName"),
                region,
                lastSeen = Str("lastSeen"),
            });
        }

        return rows;
    }
}
