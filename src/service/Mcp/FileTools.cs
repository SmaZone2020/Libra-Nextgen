using System.ComponentModel;
using System.Text.Json;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class FileTools
{
    [McpServerTool, Description("List files and directories at a given path on an agent")]
    public static async Task<string> list_directory(
        RelayService relay,
        [Description("Target agent ID")] string agentId,
        [Description("Directory path to list")] string path)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "file.list", new { path }, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("List available disk drives on an agent")]
    public static async Task<string> get_drives(
        RelayService relay,
        [Description("Target agent ID")] string agentId)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "file.drives", null, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Delete a file or directory on an agent")]
    public static async Task<string> delete_file(
        RelayService relay,
        [Description("Target agent ID")] string agentId,
        [Description("Path to the file or directory to delete")] string path)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "file.delete", new { path }, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Rename a file or directory on an agent")]
    public static async Task<string> rename_file(
        RelayService relay,
        [Description("Target agent ID")] string agentId,
        [Description("Current path")] string path,
        [Description("New name")] string newName)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "file.rename", new { path, newName }, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Move a file or directory on an agent")]
    public static async Task<string> move_file(
        RelayService relay,
        [Description("Target agent ID")] string agentId,
        [Description("Source path")] string source,
        [Description("Destination path")] string destination)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "file.move", new { source, destination }, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }

    [McpServerTool, Description("Copy a file or directory on an agent")]
    public static async Task<string> copy_file(
        RelayService relay,
        [Description("Target agent ID")] string agentId,
        [Description("Source path")] string source,
        [Description("Destination path")] string destination)
    {
        var result = await relay.RelayAndWaitAsync(agentId, "file.copy", new { source, destination }, CancellationToken.None);
        return result?.Data?.ToString() ?? "No response from agent";
    }
}
