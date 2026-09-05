using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Hosting.Server;
using Microsoft.AspNetCore.Hosting.Server.Features;
using Microsoft.IdentityModel.Tokens;
using Microsoft.Extensions.FileProviders;
using Scalar.AspNetCore;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Profiles;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Hubs;
using LibraNextgen.Service.Middleware;
using LibraNextgen.Service.Models;
using LibraNextgen.Service.Controllers;

var builder = WebApplication.CreateBuilder(args);

// Drop the Windows EventLog provider: it is disposed during host shutdown, and a
// background task (Telegram/IM receiver) logging at that moment crashes the whole
// process via Logger.ThrowLoggingError. Console output is all the server needs.
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Logging.AddDebug();

// MongoDB
builder.Services.Configure<MongoSettings>(builder.Configuration.GetSection(MongoSettings.SectionName));
builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddSingleton<ServerKeyService>();
builder.Services.AddSingleton<MongoIndexBuilder>();

// Desktop user config (libra.conf.json under --user-data-dir or the OS
// application-data default), optionally overridden by CLI flags
// (--store/--connect/--dbpath/--fallback) for portable launches. Absent in
// cloud deployments -> Mongo exactly as before: no probe, no exit.
var userConfig = UserConfigLoader.TryLoad(builder.Configuration, out var userConfigPath);
var resolvedConfig = UserConfigLoader.MergeOverrides(userConfig, builder.Configuration);
if (resolvedConfig is not null)
    builder.Services.AddSingleton(new UserConfigSource(userConfigPath ?? "(cli overrides)", resolvedConfig));

var mongoConnectString = builder.Configuration["connect"]
    ?? resolvedConfig?.Storage.ConnectString
    ?? builder.Configuration.GetSection(MongoSettings.SectionName)["ConnectionString"]
    ?? "mongodb://localhost:27017";

// Startup store decision (docs/desktop-electron-architecture.md §3): sqlite
// config -> sqlite; mongo config -> reachability probe with optional fallback
// to sqlite; no config (cloud) -> mongo, never probing or exiting.
var resolution = new StoreModeResolver(new MongoReachabilityProbe(mongoConnectString))
    .ResolveAsync(resolvedConfig)
    .GetAwaiter()
    .GetResult();

if (resolution.ExitRequested)
{
    Console.Error.WriteLine(resolution.Error);
    Environment.Exit(3);
}

var useSqlite = resolution.Effective == StoreKind.Sqlite;

if (useSqlite)
{
    var configDir = userConfigPath is not null ? Path.GetDirectoryName(userConfigPath) : null;
    var sqliteDbPath = resolvedConfig!.Storage.DbPath
        ?? (configDir is not null
            ? Path.Combine(configDir, "data", "libra.db")
            : Path.Combine(AppContext.BaseDirectory, "data", "libra.db"));
    builder.Services.AddSingleton(_ => new SqliteDbContext(sqliteDbPath));
}

// Exposed to /api/system/storage so the console can render the effective
// store and the mongo-fallback banner (docs/desktop-electron-architecture.md §3).
builder.Services.AddSingleton<StoreResolution>(_ => resolution);

// Beacon authentication (shared secret injected at build time)
builder.Services.Configure<BeaconSettings>(builder.Configuration.GetSection(BeaconSettings.SectionName));

builder.Services.Configure<AiSettings>(builder.Configuration.GetSection(AiSettings.SectionName));
builder.Services.AddSingleton<AiPromptFileLoader>();

var listenerSettings = ListenerSettingsLoader.Load();
builder.WebHost.ConfigureKestrel(options =>
{
    if (listenerSettings.BindLoopbackOnly)
        options.ListenLocalhost(listenerSettings.Port);
    else
        options.ListenAnyIP(listenerSettings.Port);

    options.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(5);
    options.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(10);
});

builder.Services.AddHttpClient();

// Per-collection stores. Repository<T> (Mongo) stays registered for consumers
// that are not yet migrated; IStore<T> resolves per effective store kind
// (SQLite on the desktop, Mongo elsewhere) and is what migrated services use.
void RegisterStore<T>(IServiceCollection services, string collectionName) where T : class
{
    services.AddSingleton(sp => new Repository<T>(sp.GetRequiredService<MongoDbContext>(), collectionName));
    services.AddSingleton<IStore<T>>(sp => useSqlite
        ? new SqliteStore<T>(sp.GetRequiredService<SqliteDbContext>(), collectionName)
        : sp.GetRequiredService<Repository<T>>());
}

RegisterStore<Agent>(builder.Services, "agents");
RegisterStore<AgentTask>(builder.Services, "tasks");
RegisterStore<User>(builder.Services, "users");
RegisterStore<MalleableProfileConfig>(builder.Services, "profiles");
RegisterStore<AccessKey>(builder.Services, "access_keys");
RegisterStore<BuildTrafficLists>(builder.Services, "build_lists");
RegisterStore<TrafficRecord>(builder.Services, "traffic");
RegisterStore<AuditLog>(builder.Services, "audit_logs");
RegisterStore<RiskPolicy>(builder.Services, "risk_policy");
RegisterStore<SessionKey>(builder.Services, "session_keys");
RegisterStore<SessionTokenDoc>(builder.Services, "session_tokens");

// Not yet migrated to IStore<T>: plugins stay Mongo-backed.
builder.Services.AddSingleton<Repository<PluginRecord>>(sp =>
    new Repository<PluginRecord>(sp.GetRequiredService<MongoDbContext>(), "plugins"));
builder.Services.AddScoped<BuildListService>();
builder.Services.AddSingleton<AiService>();

builder.Services.AddSingleton<TelegramChannelAdapter>();
builder.Services.AddSingleton<LarkChannelAdapter>();
builder.Services.AddSingleton<WeChatClawAdapter>();
builder.Services.AddSingleton<AiChannelService>();
builder.Services.AddSingleton<AiEventNotifier>();
builder.Services.AddHostedService<TelegramBotHostedService>();
builder.Services.AddHostedService<ChannelPollingHostedService>();
builder.Services.AddHostedService<LarkWsChannelService>();

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
builder.Services.AddSingleton<AuditService>();
builder.Services.AddScoped<AccessKeyService>();
builder.Services.AddSingleton<TemplateManagerService>();
builder.Services.AddSingleton<UpdateService>();
builder.Services.AddSingleton<BuilderBuildService>();
builder.Services.AddScoped<PluginService>();
builder.Services.AddHostedService<HeartbeatMonitor>();

// SQLite has no TTL indexes; a periodic purge stands in for Mongo's
// ExpireAfter (traffic retention). Mongo mode keeps its TTL indexes.
if (useSqlite)
    builder.Services.AddHostedService<StoreTtlCleanupService>();

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

var listenerSettings2 = ListenerSettingsLoader.Load();
var securitySettings = SecuritySettingsLoader.Load();
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddPolicy("CorsSignalR", policy =>
    {
        if (listenerSettings2.BindLoopbackOnly)
        {
            if (allowedOrigins.Length > 0)
                policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
            else
                policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
        else if (securitySettings.OpenLan)
        {
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
        }
        else
        {
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

// Optional console static hosting. Serves the SPA from a local web/ directory
// next to the server (desktop/local bundle) or from LIBRA_WEB_ROOT when set.
// nginx-style deployments keep hosting the SPA externally and skip this block.
var consoleWebRoot = ResolveConsoleWebRoot();
if (consoleWebRoot is not null)
{
    app.Logger.LogInformation("Serving console SPA from {WebRoot}", consoleWebRoot);
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = new PhysicalFileProvider(consoleWebRoot),
    });
}
app.MapOpenApi();
if (app.Environment.IsDevelopment())
{
    app.MapScalarApiReference(options =>
    {
        options.Title = "Libra-Nextgen API";
        options.Theme = Scalar.AspNetCore.ScalarTheme.DeepSpace;
    });
}

app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(30) });
app.UseMiddleware<BeaconEntryMiddleware>();
app.UseMiddleware<ProfileFingerprintMiddleware>();
app.UseRouting();
app.UseCors("CorsSignalR");
app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();
app.UseMiddleware<PermissionMiddleware>();
app.UseMiddleware<AuditMiddleware>();
app.MapControllers();
app.UseMiddleware<McpToggleMiddleware>();
app.MapMcp("/mcp").RequireAuthorization("McpPolicy").RequireRateLimiting("mcp");
WebSocketHandler.Map(app);

// SPA fallback (only when serving the console in-process). API/beacon/ws/mcp
// prefixes must keep 404 instead of being swallowed by index.html.
if (consoleWebRoot is not null)
{
    app.MapFallback(async context =>
    {
        var p = context.Request.Path;
        if (p.StartsWithSegments("/api") || p.StartsWithSegments("/ws") ||
            p.StartsWithSegments("/mcp") || p.StartsWithSegments("/scalar") ||
            p.StartsWithSegments("/v1"))
        {
            context.Response.StatusCode = StatusCodes.Status404NotFound;
            return;
        }
        context.Response.ContentType = "text/html; charset=utf-8";
        await context.Response.SendFileAsync(Path.Combine(consoleWebRoot!, "index.html"));
    });
}

// MongoDB bootstrap (indexes + in-memory caches) applies only in Mongo mode;
// SQLite mode skips it so a desktop boot never touches a Mongo server.
if (!useSqlite)
{
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
}

if (resolvedConfig is not null)
{
    var userCfgLog = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("UserConfig");
    userCfgLog.LogInformation(
        "User config from {ConfigPath}: requested={Requested} effective={Effective} fallbackReason={FallbackReason}",
        userConfigPath ?? "(cli overrides)", resolution.Requested, resolution.Effective, resolution.FallbackReason ?? "-");
}

app.Run();

/// <summary>Exposed for WebApplicationFactory-based integration tests.</summary>

/// <summary>
/// Locate a console SPA directory for in-process hosting. Resolution order:
/// LIBRA_WEB_ROOT env, ./web next to the current directory, web next to the
/// app base. Returns null when absent so nginx deployments are untouched.
/// </summary>
static string? ResolveConsoleWebRoot()
{
    var fromEnv = Environment.GetEnvironmentVariable("LIBRA_WEB_ROOT");
    if (!string.IsNullOrWhiteSpace(fromEnv))
        return Directory.Exists(fromEnv) ? Path.GetFullPath(fromEnv) : null;

    foreach (var candidate in new[]
             {
                 Path.Combine(Directory.GetCurrentDirectory(), "web"),
                 Path.Combine(AppContext.BaseDirectory, "web"),
             })
    {
        if (Directory.Exists(candidate))
            return Path.GetFullPath(candidate);
    }
    return null;
}

public partial class Program { }

