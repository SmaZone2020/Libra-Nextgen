using LibraNextgen.Common.Models;
using Microsoft.Extensions.Options;
using MongoDB.Driver;
using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Data;

/// <summary>
/// Creates the MongoDB indexes the app relies on. Idempotent — called once at
/// startup. Without these, every registration/heartbeat performs a full
/// collection scan and traffic/task collections grow unbounded.
/// </summary>
public class MongoIndexBuilder
{
    private readonly MongoDbContext _context;
    private readonly MongoSettings _settings;
    private readonly ILogger<MongoIndexBuilder> _logger;

    public MongoIndexBuilder(
        MongoDbContext context,
        IOptions<MongoSettings> settings,
        ILogger<MongoIndexBuilder> logger)
    {
        _context = context;
        _settings = settings.Value;
        _logger = logger;
    }

    public async Task EnsureIndexesAsync(CancellationToken ct = default)
    {
        await CreateAgentsAsync(ct);
        await CreateTasksAsync(ct);
        await CreateTrafficAsync(ct);
        await CreateUsersAsync(ct);
        await CreateAuditLogsAsync(ct);
        await CreateAiAsync(ct);
        await CreateAiChannelsAsync(ct);
    }

    private async Task CreateAgentsAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<Agent>("agents");
        var models = new[]
        {
            new CreateIndexModel<Agent>(Builders<Agent>.IndexKeys.Ascending(a => a.Hwid)),
            new CreateIndexModel<Agent>(Builders<Agent>.IndexKeys.Ascending(a => a.Hostname).Ascending(a => a.UserName)),
            new CreateIndexModel<Agent>(Builders<Agent>.IndexKeys.Ascending(a => a.Status).Descending(a => a.LastSeen)),
        };
        await col.Indexes.CreateManyAsync(models, ct);
    }

    private async Task CreateTasksAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<AgentTask>("tasks");
        var models = new[]
        {
            new CreateIndexModel<AgentTask>(Builders<AgentTask>.IndexKeys.Ascending(t => t.AgentId).Ascending(t => t.Status).Ascending(t => t.CreatedAt)),
            new CreateIndexModel<AgentTask>(Builders<AgentTask>.IndexKeys.Ascending(t => t.Status).Descending(t => t.CreatedAt)),
        };
        await col.Indexes.CreateManyAsync(models, ct);
    }

    private async Task CreateTrafficAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<TrafficRecord>("traffic");

        var models = new List<CreateIndexModel<TrafficRecord>>();
        if (_settings.TrafficTtlDays > 0)
        {
            models.Add(new CreateIndexModel<TrafficRecord>(
                Builders<TrafficRecord>.IndexKeys.Ascending(t => t.Timestamp),
                new CreateIndexOptions { ExpireAfter = TimeSpan.FromDays(_settings.TrafficTtlDays) }));
        }
        else
        {
            models.Add(new CreateIndexModel<TrafficRecord>(
                Builders<TrafficRecord>.IndexKeys.Descending(t => t.Timestamp)));
        }

        await col.Indexes.CreateManyAsync(models, ct);
    }

    private async Task CreateUsersAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<User>("users");
        await col.Indexes.CreateOneAsync(
            new CreateIndexModel<User>(
                Builders<User>.IndexKeys.Ascending(u => u.Username),
                new CreateIndexOptions { Unique = true }),
            cancellationToken: ct);
    }

    private async Task CreateAuditLogsAsync(CancellationToken ct)
    {
        var col = _context.GetCollection<AuditLog>("audit_logs");
        await col.Indexes.CreateOneAsync(
            new CreateIndexModel<AuditLog>(Builders<AuditLog>.IndexKeys.Descending(a => a.Timestamp)),
            cancellationToken: ct);
    }

    private async Task CreateAiAsync(CancellationToken ct)
    {
        var sessions = _context.GetCollection<AiSession>("ai_sessions");
        await sessions.Indexes.CreateOneAsync(
            new CreateIndexModel<AiSession>(Builders<AiSession>.IndexKeys
                .Ascending(s => s.UserId)
                .Descending(s => s.UpdatedAt)),
            cancellationToken: ct);

        // 频道会话：按 (ChannelId, ChannelExternalId) 唯一（partial filter 避免
        // 控制台会话的 null ChannelId 互撞——Mongo 唯一索引把 null 视为相等）。
        await sessions.Indexes.CreateOneAsync(
            new CreateIndexModel<AiSession>(
                Builders<AiSession>.IndexKeys
                    .Ascending(s => s.ChannelId)
                    .Ascending(s => s.ChannelExternalId),
                new CreateIndexOptions<AiSession>
                {
                    Unique = true,
                    PartialFilterExpression = Builders<AiSession>.Filter.Type(s => s.ChannelId, MongoDB.Bson.BsonType.String),
                }),
            cancellationToken: ct);
    }

    private async Task CreateAiChannelsAsync(CancellationToken ct)
    {
        var users = _context.GetCollection<AiChannelUser>("ai_channel_users");
        await users.Indexes.CreateOneAsync(
            new CreateIndexModel<AiChannelUser>(
                Builders<AiChannelUser>.IndexKeys
                    .Ascending(u => u.ChannelId)
                    .Ascending(u => u.ExternalId),
                new CreateIndexOptions { Unique = true }),
            cancellationToken: ct);

        var codes = _context.GetCollection<AiChannelBindCode>("ai_channel_bind_codes");
        await codes.Indexes.CreateOneAsync(
            new CreateIndexModel<AiChannelBindCode>(
                Builders<AiChannelBindCode>.IndexKeys
                    .Ascending(b => b.ChannelId)
                    .Ascending(b => b.ExpiresAt)),
            cancellationToken: ct);
        // TTL：过期绑定码自动清理（防未使用码堆积）。
        await codes.Indexes.CreateOneAsync(
            new CreateIndexModel<AiChannelBindCode>(
                Builders<AiChannelBindCode>.IndexKeys.Ascending(b => b.ExpiresAt),
                new CreateIndexOptions { ExpireAfter = TimeSpan.Zero }),
            cancellationToken: ct);

        var cursors = _context.GetCollection<AiChannelCursor>("ai_channel_cursors");
        await cursors.Indexes.CreateOneAsync(
            new CreateIndexModel<AiChannelCursor>(
                Builders<AiChannelCursor>.IndexKeys.Ascending(c => c.ChannelId),
                new CreateIndexOptions { Unique = true }),
            cancellationToken: ct);
    }
}
