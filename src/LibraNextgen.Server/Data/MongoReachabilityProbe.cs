using MongoDB.Bson;
using MongoDB.Driver;

namespace LibraNextgen.Service.Data;

/// <summary>Real MongoDB reachability probe: issues a <c>ping</c> command with
/// short connect/server-selection timeouts so startup can fail fast and (when
/// configured) fall back to the SQLite store.</summary>
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
            await client.GetDatabase("admin")
                .RunCommandAsync<BsonDocument>(new BsonDocument("ping", 1), cancellationToken: timeoutCts.Token);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
