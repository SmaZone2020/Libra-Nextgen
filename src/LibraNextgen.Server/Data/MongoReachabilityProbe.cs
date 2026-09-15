using MongoDB.Bson;
using MongoDB.Driver;

namespace LibraNextgen.Service.Data;

/// <summary>Real MongoDB reachability probe: issues a <c>ping</c> command with
/// short connect/server-selection timeouts so a configured-but-unreachable store
/// fails fast at startup (or, in probe mode, before anything is bound).</summary>
public sealed class MongoReachabilityProbe : IMongoReachabilityProbe
{
    private readonly string _connectionString;
    private readonly TimeSpan _timeout;

    public MongoReachabilityProbe(string connectionString, TimeSpan? timeout = null)
    {
        _connectionString = connectionString;
        _timeout = timeout ?? TimeSpan.FromSeconds(5);
    }

    public async Task<bool> IsReachableAsync(CancellationToken ct = default)
    {
        try
        {
            var settings = MongoClientSettings.FromConnectionString(_connectionString);
            settings.ConnectTimeout = _timeout;
            settings.ServerSelectionTimeout = _timeout;
            settings.SocketTimeout = _timeout;

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeoutCts.CancelAfter(_timeout);

            var client = new MongoClient(settings);
            await client.GetDatabase(ResolveProbeDatabase(_connectionString))
                .RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: timeoutCts.Token);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Ping the database the connection string names: a user-supplied credential
    /// is often scoped to its own database, and pinging an unauthorized
    /// <c>admin</c> would report a healthy server as unreachable. Only a string
    /// naming no database at all falls back to <c>admin</c>.
    /// </summary>
    public static string ResolveProbeDatabase(string connectionString)
    {
        var databaseName = MongoUrl.Create(connectionString).DatabaseName;
        return string.IsNullOrWhiteSpace(databaseName) ? "admin" : databaseName;
    }
}
