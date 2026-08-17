using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class FileTools
{
    [McpServerTool, Description("List files and directories at a given path on an agent")]
    public static async Task<string> list_directory(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Directory path to list")] string path)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "file.list", new { path }, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("List available disk drives on an agent")]
    public static async Task<string> get_drives(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "file.drives", null, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Delete a file or directory on an agent")]
    public static async Task<string> delete_file(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Path to the file or directory to delete")] string path)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "file.delete", new { path }, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Rename a file or directory on an agent")]
    public static async Task<string> rename_file(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Current path")] string path,
        [Description("New name")] string newName)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "file.rename", new { path, newName }, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Move a file or directory on an agent")]
    public static async Task<string> move_file(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Source path")] string source,
        [Description("Destination path")] string destination)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "file.move", new { source, destination }, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Copy a file or directory on an agent")]
    public static async Task<string> copy_file(
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Source path")] string source,
        [Description("Destination path")] string destination)
    {
        return await McpUtils.RelayOrError(relay, agents, agentId, "file.copy", new { source, destination }, TimeSpan.FromSeconds(30));
    }
}