using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
/// 单入口路由（流量伪装 Phase 2）。
///
/// 路由规则（白名单式，天然免疫管理端点误伤）：
///   仅当请求路径 == 入口前缀，或 == 入口前缀 + "/" + profile 配置的
///   path_suffixes 中的某一个时，重写到内部端点 /api/beacon/handle。
///   其余路径（/api/auth/*、/api/account/* 等全部管理员 API）一律放行，
///   由 JWT/RBAC 与既有路由处理。
///
/// 这样无需维护"管理前缀排除列表"——任何新增/改名 controller 都不会被误吞；
/// 入口与后缀集合完全由 profile 配置驱动（agent 侧只从同一列表随机选择）。
///
/// 旧版 beacon 端点（/api/beacon/*）不在入口后缀集合内，保持原样兼容旧 agent。
/// </summary>
public class BeaconEntryMiddleware
{
    private readonly RequestDelegate _next;

    public BeaconEntryMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, ProfileService profileService)
    {
        var path = context.Request.Path.Value ?? "/";

        // 旧 beacon 端点直接放行（兼容旧 agent）
        if (path.StartsWith("/api/beacon/", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
        }

        var profile = await profileService.GetActiveProfileAsync();
        string entryPath;
        List<string> suffixes;
        if (profile is Profiles.ConfigurableProfile cp)
        {
            entryPath = "/" + cp.Config.EntryPath.TrimStart('/');
            suffixes = cp.Config.PathSuffixes ?? new();
        }
        else
        {
            entryPath = "/api"; // DefaultProfile 固定值
            suffixes = new List<string>
            {
                "user/info", "orders/list", "profile", "settings",
                "notifications", "messages/unread",
            };
        }

        // 白名单匹配：入口精确 + 入口/已知业务后缀
        var matched = path.Equals(entryPath, StringComparison.OrdinalIgnoreCase);
        if (!matched)
        {
            var prefix = entryPath.TrimEnd('/') + "/";
            foreach (var s in suffixes)
            {
                var candidate = prefix + s.TrimStart('/');
                if (path.Equals(candidate, StringComparison.OrdinalIgnoreCase))
                {
                    matched = true;
                    break;
                }
            }
        }

        if (matched)
        {
            context.Request.Path = "/api/beacon/handle";
        }

        await _next(context);
    }
}
