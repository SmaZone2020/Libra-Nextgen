using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class ScreenTools
{
    [McpServerTool, Description("Take a screenshot from an agent's display")]
    public static async Task<string> take_screenshot(
        TaskService taskService,
        [Description("Target agent ID")] string agentId)
    {
        var request = new Common.Models.TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = Common.Models.CommandType.Screenshot,
            Command = "capture",
            TimeoutSeconds = 15
        };
        var task = await taskService.CreateAsync(request, "mcp-client");
        return JsonSerializer.Serialize(new { task.Id, task.Status, message = "Screenshot task created. Poll get_task for base64 result." });
    }

    [McpServerTool, Description("Capture a frame from the agent's webcam")]
    public static async Task<string> capture_webcam(
        TaskService taskService,
        [Description("Target agent ID")] string agentId)
    {
        var request = new Common.Models.TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = Common.Models.CommandType.Webcam,
            Command = "capture",
            TimeoutSeconds = 15
        };
        var task = await taskService.CreateAsync(request, "mcp-client");
        return JsonSerializer.Serialize(new { task.Id, task.Status, message = "Webcam capture task created." });
    }
}
