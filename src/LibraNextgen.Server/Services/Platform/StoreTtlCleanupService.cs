using LibraNextgen.Common.Models;
using LibraNextgen.Service.Configuration;
using LibraNextgen.Service.Data;
using Microsoft.Extensions.Options;

namespace LibraNextgen.Service.Services.Platform;

/// <summary>
/// Periodic purge for the SQLite document store, standing in for the Mongo TTL
/// indexes (traffic retention). Registered only in sqlite mode — Mongo mode
/// keeps its native ExpireAfter indexes. Purge logic is a static helper so it
/// is unit-testable against any IStore implementation.
/// </summary>
public sealed class StoreTtlCleanupService : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptions<MongoSettings> _mongoSettings;
    private readonly ILogger<StoreTtlCleanupService> _logger;

    public StoreTtlCleanupService(
        IServiceScopeFactory scopeFactory,
        IOptions<MongoSettings> mongoSettings,
        ILogger<StoreTtlCleanupService> logger)
    {
        _scopeFactory = scopeFactory;
        _mongoSettings = mongoSettings;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await PurgeTrafficAsync(stoppingToken);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "SQLite TTL traffic purge failed");
            }

            try
            {
                await Task.Delay(TimeSpan.FromHours(6), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task PurgeTrafficAsync(CancellationToken ct)
    {
        var ttlDays = _mongoSettings.Value.TrafficTtlDays;
        if (ttlDays <= 0)
            return;

        using var scope = _scopeFactory.CreateScope();
        var traffic = scope.ServiceProvider.GetRequiredService<IStore<TrafficRecord>>();
        var cutoff = DateTime.UtcNow.AddDays(-ttlDays);
        var purged = await PurgeOlderThanAsync(traffic, r => r.Timestamp, cutoff, ct);
        if (purged > 0)
            _logger.LogInformation("Purged {Count} traffic records older than {Cutoff}", purged, cutoff);
    }

    /// <summary>Delete every stored document whose timestamp predates the
    /// cutoff; returns the number of deleted rows. Works on any IStore via the
    /// entity's string Id property.</summary>
    public static async Task<long> PurgeOlderThanAsync<T>(
        IStore<T> store, Func<T, DateTime> timestampOf, DateTime cutoff, CancellationToken ct = default)
        where T : class
    {
        var all = await store.GetAllAsync(ct);
        long purged = 0;
        foreach (var entity in all)
        {
            if (timestampOf(entity) < cutoff)
            {
                var id = EntityId(entity);
                if (id is not null)
                    purged += await store.DeleteAsync(id, ct);
            }
        }
        return purged;
    }

    private static string? EntityId<T>(T entity) where T : class =>
        typeof(T).GetProperty("Id")?.GetValue(entity) as string;
}
