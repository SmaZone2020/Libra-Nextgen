using System.ComponentModel;
using ModelContextProtocol.Server;
using LibraNextgen.Service.Services;
using Microsoft.AspNetCore.Http;

namespace LibraNextgen.Service.Mcp;

[McpServerToolType]
public sealed class FileTools
{
    [McpServerTool, Description("List files and directories at a given path on an agent")]
    public static async Task<string> list_directory(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Directory path to list")] string path,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "files",
            new { op = "list", path }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("List available disk drives on an agent")]
    public static async Task<string> get_drives(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "files",
            new { op = "drives" }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Read a file's content from an agent (returns base64 in {content}; large files may be truncated)")]
    public static async Task<string> read_file(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Absolute path of the file to read")] string path,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "files",
            new { op = "read", path }, ct, TimeSpan.FromSeconds(45));
    }

    [McpServerTool, Description("Delete a file or directory on an agent (requires Admin)")]
    public static async Task<string> delete_file(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Path to the file or directory to delete")] string path,
        CancellationToken ct = default)
    {
        var caller = McpUtils.GetCaller(http);
        var adminError = McpUtils.RequireAdmin(caller, "delete_file");
        if (adminError.Length > 0) return adminError;

        return await McpUtils.RelayOrError(relay, agents, caller, agentId, "files",
            new { op = "delete", path }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Rename a file or directory on an agent")]
    public static async Task<string> rename_file(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Current path")] string path,
        [Description("New name")] string newName,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "files",
            new { op = "rename", path, newName }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Move a file or directory on an agent")]
    public static async Task<string> move_file(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Source path")] string source,
        [Description("Destination path")] string destination,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "files",
            new { op = "move", path = source, destination }, ct, TimeSpan.FromSeconds(30));
    }

    [McpServerTool, Description("Copy a file or directory on an agent")]
    public static async Task<string> copy_file(
        IHttpContextAccessor http,
        RelayService relay,
        AgentService agents,
        [Description("Target agent ID")] string agentId,
        [Description("Source path")] string source,
        [Description("Destination path")] string destination,
        CancellationToken ct = default)
    {
        return await McpUtils.RelayOrError(relay, agents, McpUtils.GetCaller(http), agentId, "files",
            new { op = "copy", path = source, destination }, ct, TimeSpan.FromSeconds(30));
    }
}
