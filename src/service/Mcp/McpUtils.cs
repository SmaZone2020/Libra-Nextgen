using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

/// <summary>
/// Shared helpers for MCP tools: agent online checks, relay with sane timeouts,
/// output size limiting and structured errors.
/// </summary>
public static class McpUtils
{
    /// <summary>Cap for a single tool response (avoids blowing up the MCP transport).</summary>
    public const int MaxOutputBytes = 1024 * 1024;

    public static string Error(string message) =>
        JsonSerializer.Serialize(new { error = message });

    public static string Ok(object value) =>
        JsonSerializer.Serialize(value);

    public static async Task<bool> IsOnlineAsync(AgentService agents, string agentId)
    {
        var agent = await agents.GetByIdAsync(agentId);
        return agent?.Status == AgentStatus.Online;
    }

    public static string Limit(string json)
    {
        if (json.Length <= MaxOutputBytes) return json;
        return json[..MaxOutputBytes] + "\n... (output truncated)";
    }

    /// <summary>
    /// Relay a request to an agent with a sane default timeout, checking the
    /// agent is online up front and normalizing failures into structured JSON.
    /// </summary>
    public static async Task<string> RelayOrError(
        RelayService relay,
        AgentService agents,
        string agentId,
        string messageType,
        object? data,
        TimeSpan? timeout = null)
    {
        if (string.IsNullOrWhiteSpace(agentId))
            return Error("agentId is required");

        if (!await IsOnlineAsync(agents, agentId))
            return Error($"agent '{agentId}' is offline or not found");

        var result = await relay.RelayAndWaitAsync(
            agentId, messageType, data, CancellationToken.None,
            timeout ?? TimeSpan.FromSeconds(30));

        if (result?.Data == null)
            return Error("agent did not respond in time");

        return Limit(result.Data.Value.GetRawText());
    }

    /// <summary>
    /// Create a task for an agent and wait for its terminal state so a single
    /// MCP call returns the actual output. The wait timeout is the task timeout
    /// plus a buffer for the agent's heartbeat latency.
    /// </summary>
    public static async Task<string> CreateTaskAndWait(
        TaskService tasks,
        AgentService agents,
        string agentId,
        CommandType commandType,
        string command,
        int timeoutSeconds = 30,
        List<string>? arguments = null)
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
        var task = await tasks.CreateAsync(request, "mcp-client");

        var result = await tasks.WaitForCompletionAsync(
            task.Id, TimeSpan.FromSeconds(timeoutSeconds + 20));

        if (result == null)
            return Error($"task '{task.Id}' not found after waiting");

        return Ok(new
        {
            taskId = result.Id,
            status = result.Status.ToString(),
            output = result.Output,
            error = result.Error
        });
    }
}