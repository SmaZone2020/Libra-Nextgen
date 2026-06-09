using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.Tokens;
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

// JWT Settings (singleton so EnsureKeys is shared)
var jwtSettings = builder.Configuration.GetSection(JwtSettings.SectionName).Get<JwtSettings>() ?? new JwtSettings();
jwtSettings.EnsureKeys();
builder.Services.AddSingleton(jwtSettings);
builder.Services.AddScoped<AuthService>();
builder.Services.AddScoped<ProfileService>();
builder.Services.AddScoped<AgentService>();
builder.Services.AddScoped<TaskService>();
builder.Services.AddScoped<AgentCommsService>();

// WebSocket
builder.Services.AddSingleton<ISessionLock, ShellSessionLock>();
builder.Services.AddSingleton<ConnectionManager>();
builder.Services.AddScoped<AuditService>();

// Auth
using var rsa = RSA.Create();
rsa.ImportFromPem(jwtSettings.PublicKey);

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
            IssuerSigningKey = new RsaSecurityKey(rsa),
            ClockSkew = TimeSpan.Zero
        };
    });
builder.Services.AddAuthorization();

// Controllers + OpenAPI
builder.Services.AddControllers();
builder.Services.AddOpenApi();

// WebSocket middleware is enabled via app.UseWebSockets()

// CORS
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        policy.AllowAnyOrigin().AllowAnyHeader().AllowAnyMethod();
    });
    options.AddPolicy("CorsSignalR", policy =>
    {
        policy.SetIsOriginAllowed(_ => true).AllowAnyHeader().AllowAnyMethod().AllowCredentials();
    });
});

var app = builder.Build();

// Seed default admin user
using (var scope = app.Services.CreateScope())
{
    var authService = scope.ServiceProvider.GetRequiredService<AuthService>();
    await authService.SeedDefaultAdminAsync();
}

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
}

app.UseCors("CorsSignalR");
app.UseWebSockets();
app.UseAuthentication();
app.UseAuthorization();
app.UseMiddleware<AuditMiddleware>();
app.MapControllers();
WebSocketHandler.Map(app);
app.Run();
