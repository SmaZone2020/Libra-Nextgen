using System.Text.Json;
using LibraNextgen.Common.Models;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Services;

/// <summary>
/// 任务化 relay（零 WS 架构）：REST 端点 → 创建 Generic 任务（module + input）
/// → SSE 推送 → agent 执行 → 结果上报 → 等待完成 → 返回 agent 原始输出 JSON。
/// 前端 API 签名不变（各 controller 透传 agent 输出）。
/// </summary>
public class RelayService
{
    private readonly TaskService _tasks;
    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(60);

    /// <summary>
    /// 需要在 agent 子进程中隔离执行的云模块（白名单）。这些模块 FFI 密集、
    /// 崩溃风险最高（浏览器凭据解密、lsass dump、kerberos 等）；隔离执行后
    /// 模块崩溃只损失子进程，agent 本体不受影响。agent 侧约定：
    /// Generic 任务 arguments 追加 "isolated=true" → fork 子进程执行。
    /// </summary>
    public static readonly HashSet<string> IsolatedModules = new(StringComparer.Ordinal)
    {
        "creds", // 浏览器密码/历史、RDP/SSH/微信凭据、lsass、kerberos、SAM
    };

    /// <summary>判断某云模块是否默认隔离执行。</summary>
    public static bool IsIsolatedModule(string module) => IsolatedModules.Contains(module);

    public RelayService(TaskService tasks)
    {
        _tasks = tasks;
    }

    /// <summary>
    /// 向 agent 下发通用模块任务并等待完成。返回 agent 模块输出 JSON 文本
    /// （如 files 模块的 {"path":..,"entries":[..]}）；超时/失败/无响应返回 null。
    ///
    /// 超时或请求取消时，若任务仍处于 Pending，会将其取消——避免"MCP 显示失败、
    /// agent 稍后捡起执行"的误导性副作用（例如 delete_file 调用超时后真的删了文件）。
    /// </summary>
    public async Task<string?> RelayAndWaitAsync(
        string agentId, string module, object? data,
        CancellationToken ct, TimeSpan? timeout = null, string? createdBy = null)
    {
        var total = timeout ?? DefaultTimeout;
        var arguments = new List<string> { JsonSerializer.Serialize(data ?? new { }) };
        if (IsIsolatedModule(module))
            arguments.Add("isolated=true");
        var created = await _tasks.CreateAsync(new TaskCreateRequest
        {
            AgentId = agentId,
            CommandType = CommandType.Generic,
            Command = module,
            Arguments = arguments.ToArray(),
            TimeoutSeconds = Math.Clamp((int)total.TotalSeconds, 5, 3600),
        }, createdBy ?? "system-relay", isAdmin: true, ct);

        AgentTask? done;
        try
        {
            done = await _tasks.WaitForCompletionAsync(created.Id, total, ct);
        }
        catch (OperationCanceledException)
        {
            // 客户端断开/取消：任务不应留在队列里稍后执行。
            await SafeCancelPendingAsync(created.Id);
            throw;
        }

        if (done == null || done.Status != TaskStatus.Completed)
        {
            if (done?.Status == TaskStatus.Pending)
                await SafeCancelPendingAsync(created.Id);
            return null;
        }
        return done.Output;
    }

    private async Task SafeCancelPendingAsync(string taskId)
    {
        try
        {
            await _tasks.CancelPendingByIdAsync(taskId, CancellationToken.None);
        }
        catch
        {
            // Best-effort cleanup only; never mask the original failure.
        }
    }
}
