using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Data;

public enum StoreKind
{
    Mongo,
    Sqlite,
}

/// <summary>Outcome of the startup store resolution (docs/desktop-electron-architecture.md §3).</summary>
public sealed record StoreResolution(
    StoreKind Requested,
    StoreKind Effective,
    string? FallbackReason,
    bool ExitRequested,
    string? Error);

/// <summary>Abstraction over the reachability probe so resolution is testable
/// without a live MongoDB.</summary>
public interface IMongoReachabilityProbe
{
    Task<bool> IsReachableAsync(CancellationToken ct = default);
}

/// <summary>
/// Decides which store the service runs on before the DI container is built:
/// no user config file (cloud deployment) means Mongo exactly as today, never
/// an exit; a desktop config selects sqlite directly or mongo after a startup
/// probe. When a configured mongo store is unreachable the service exits with
/// an error — falling back to sqlite was removed by product decision, so a
/// silent store switch can never hide a broken MongoDB setup
/// (docs/desktop-electron-architecture.md §3).
/// </summary>
public sealed class StoreModeResolver
{
    private readonly IMongoReachabilityProbe _probe;

    public StoreModeResolver(IMongoReachabilityProbe probe)
    {
        _probe = probe;
    }

    public async Task<StoreResolution> ResolveAsync(UserConfig? userConfig, CancellationToken ct = default)
    {
        if (userConfig is null)
            return new StoreResolution(StoreKind.Mongo, StoreKind.Mongo, null, false, null);

        var requested = userConfig.Storage.Mode.Equals("sqlite", StringComparison.OrdinalIgnoreCase)
            ? StoreKind.Sqlite
            : StoreKind.Mongo;

        if (requested == StoreKind.Sqlite)
            return new StoreResolution(requested, StoreKind.Sqlite, null, false, null);

        var reachable = await _probe.IsReachableAsync(ct);
        if (reachable)
            return new StoreResolution(requested, StoreKind.Mongo, null, false, null);

        return new StoreResolution(
            requested, StoreKind.Mongo, "mongo_unreachable", true,
            "MongoDB unreachable at startup and fallback to SQLite was removed; set storage.mode=sqlite to run on the local store.");
    }
}
