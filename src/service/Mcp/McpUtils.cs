using System.Security.Claims;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Http;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// Shared helpers for MCP tools: caller identity (access-key claims), admin
/// gating for destructive tools, agent online checks, relay with sane timeouts,
/// output size limiting and structured errors.
/// </summary>
public static class McpUtils
{
    /// <summary>Cap for a single tool response (avoids blowing up the MCP transport).</summary>
    public const int MaxOutputBytes = 1024 * 1024;

    /// <summary>
    /// 统一序列化选项：camelCase + 枚举转字符串。
    /// 与 REST API 的 JsonStringEnumConverter 对齐——否则 AgentStatus/TaskStatus
    /// 会被序列化成数字（Online=0, Offline=1），LLM 会把 0 当成“离线”、1 当成
    /// “在线”，导致在线/离线状态反转。
    /// </summary>
    public static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.CamelCase) },
    };

    public static string Error(string message) =>
        JsonSerializer.Serialize(new { error = message }, JsonOpts);

    public static string Ok(object value) =>
        JsonSerializer.Serialize(value, JsonOpts);

    /// <summary>
    /// Identity of the access-key caller for the current MCP request.
    /// 注意：SDK 1.4.0 不把 RequestContext&lt;T&gt; 绑定为工具参数（会被当成 schema
    /// 参数），因此经 IHttpContextAccessor 取 HttpContext.User。
    /// </summary>
    public sealed record McpCaller(string UserId, string UserName, bool IsAdmin);

    public static McpCaller GetCaller(IHttpContextAccessor http) =>
        GetCaller(http.HttpContext);

    public static McpCaller GetCaller(HttpContext? http)
    {
        var user = http?.User;
        return new McpCaller(
            user?.FindFirst(ClaimTypes.NameIdentifier)?.Value ?? "anonymous",
            user?.Identity?.Name ?? "mcp-client",
            user?.IsInRole("Admin") ?? false);
    }

    /// <summary>Empty when allowed; otherwise a structured error requiring an Admin key.</summary>
    public static string RequireAdmin(McpCaller caller, string toolName) =>
        caller.IsAdmin ? "" : Error($"tool '{toolName}' requires an Admin access key");

    public static async Task<bool> IsOnlineAsync(AgentService agents, string agentId)
    {
        var agent = await agents.GetByIdAsync(agentId);
        return agent?.Status == AgentStatus.Online;
    }

    /// <summary>
    /// Truncate to <see cref="MaxOutputBytes"/> UTF-8 bytes without splitting a
    /// multi-byte rune, appending a visible marker. (A naive char-count cut can
    /// split a surrogate pair or produce invalid JSON mid-string.)
    /// </summary>
    public static string Limit(string json)
    {
        if (string.IsNullOrEmpty(json) || Encoding.UTF8.GetByteCount(json) <= MaxOutputBytes)
            return json;

        var sb = new StringBuilder(MaxOutputBytes / 2);
        var used = 0;
        foreach (var rune in json.EnumerateRunes())
        {
            var len = rune.Utf8SequenceLength;
            if (used + len > MaxOutputBytes) break;
            sb.Append(rune.ToString());
            used += len;
        }
        return sb.ToString() + "\n... (output truncated)";
    }

    /// <summary>
    /// Relay a task to an agent with a sane default timeout, checking the
    /// agent is online up front and normalizing failures into structured JSON.
    /// `module` 为云模块名（files/recon/creds/proxy/token/script），data 含 op。
    /// Timeouts cancel the still-pending task so a "failed" call cannot execute later.
    /// </summary>
    public static async Task<string> RelayOrError(
        RelayService relay,
        AgentService agents,
        McpCaller caller,
        string agentId,
        string module,
        object? data,
        CancellationToken ct,
        TimeSpan? timeout = null)
    {
        if (string.IsNullOrWhiteSpace(agentId))
            return Error("agentId is required");

        if (!await IsOnlineAsync(agents, agentId))
            return Error($"agent '{agentId}' is offline or not found");

        var result = await relay.RelayAndWaitAsync(
            agentId, module, data, ct,
            timeout ?? TimeSpan.FromSeconds(30), caller.UserName);

        if (result == null)
            return Error("agent did not respond in time; pending task cancelled");

        return Limit(result);
    }

    /// <summary>
    /// Create a task for an agent and wait for its terminal state so a single
    /// MCP call returns the actual output. The wait timeout is the task timeout
    /// plus a buffer for the agent's heartbeat latency. On timeout a still-pending
    /// task is cancelled; a task already dispatched (Sent/Running) is reported
    /// with its taskId so the client can poll get_task instead of assuming failure.
    /// </summary>
    public static async Task<string> CreateTaskAndWait(
        TaskService tasks,
        AgentService agents,
        McpCaller caller,
        string agentId,
        CommandType commandType,
        string command,
        int timeoutSeconds = 30,
        List<string>? arguments = null,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(agentId))
            return Error("agentId is required");

        if (!await IsOnlineAsync(agents, agentId))
            return Error($"agent '{agentId}' is offline or not found");

        var request = new TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = commandType,
            Command = command,
            TimeoutSeconds = Math.Max(1, timeoutSeconds),
            Arguments = (arguments ?? new List<string>()).ToArray()
        };

        AgentTask task;
        try
        {
            task = await tasks.CreateAsync(request, caller.UserName, caller.IsAdmin, ct);
        }
        catch (UnauthorizedAccessException ex)
        {
            return Error(ex.Message);
        }

        var result = await tasks.WaitForCompletionAsync(
            task.Id, TimeSpan.FromSeconds(timeoutSeconds + 20), ct);

        if (result == null)
            return Error($"task '{task.Id}' not found after waiting");

        if (result.Status == TaskStatus.Pending)
        {
            // 等待窗口耗尽仍未被 agent 领取：取消，避免稍后意外执行。
            await tasks.CancelPendingByIdAsync(result.Id, CancellationToken.None);
            return Error($"task '{task.Id}' timed out; pending task cancelled");
        }

        if (result.Status is not (TaskStatus.Completed or TaskStatus.Failed or TaskStatus.Cancelled))
        {
            // 已下发但未在窗口内结束（Sent/Running）：如实告知，供 get_task 轮询。
            return Ok(new
            {
                taskId = result.Id,
                status = result.Status.ToString(),
                note = "task dispatched; poll get_task for the final result"
            });
        }

        return Ok(new
        {
            taskId = result.Id,
            status = result.Status.ToString(),
            output = result.Output,
            error = result.Error
        });
    }
}
