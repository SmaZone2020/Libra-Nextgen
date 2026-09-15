using System.Text.Json;
using LibraNextgen.Service.Data;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>
/// The probe-mode wire contract (LIBRA_STORAGE_PROBE=1): the desktop shell parses
/// the single stdout line, so the exact field names, order and values are pinned
/// here instead of being exercised through Environment.Exit.
/// </summary>
public class StorageProbeReportTests
{
    private static StoreResolution Resolved(StoreKind requested, StoreKind effective, bool exit = false,
        string? error = null, string? fallbackReason = null)
        => new(requested, effective, fallbackReason, exit, error);

    [Fact]
    public void ReachableMongo_RendersExactJsonLine()
    {
        var json = StorageProbeReport.Render(Resolved(StoreKind.Mongo, StoreKind.Mongo));

        Assert.Equal("""{"reachable":true,"requested":"mongo","effective":"mongo","error":null}""", json);
    }

    [Fact]
    public void SqliteConfig_IsReachable_ExactJsonLine()
    {
        var json = StorageProbeReport.Render(Resolved(StoreKind.Sqlite, StoreKind.Sqlite));

        Assert.Equal("""{"reachable":true,"requested":"sqlite","effective":"sqlite","error":null}""", json);
    }

    [Fact]
    public void UnreachableMongo_RendersFailureWithReason()
    {
        var json = StorageProbeReport.Render(Resolved(
            StoreKind.Mongo, StoreKind.Mongo, exit: true,
            error: "MongoDB unreachable at startup", fallbackReason: "mongo_unreachable"));

        Assert.Equal(
            """{"reachable":false,"requested":"mongo","effective":"mongo","error":"MongoDB unreachable at startup"}""",
            json);
    }

    [Fact]
    public void Failure_FallsBackToFallbackReason_ThenToAGenericReason()
    {
        Assert.Equal("mongo_unreachable", StorageProbeReport.Reason(
            Resolved(StoreKind.Mongo, StoreKind.Mongo, exit: true, fallbackReason: "mongo_unreachable")));
        Assert.False(string.IsNullOrWhiteSpace(StorageProbeReport.Reason(
            Resolved(StoreKind.Mongo, StoreKind.Mongo, exit: true))));
    }

    [Fact]
    public void ExitCode_IsZeroWhenReachable_FourWhenNot()
    {
        Assert.Equal(0, StorageProbeReport.ExitCode(Resolved(StoreKind.Mongo, StoreKind.Mongo)));
        Assert.Equal(0, StorageProbeReport.ExitCode(Resolved(StoreKind.Sqlite, StoreKind.Sqlite)));
        Assert.Equal(4, StorageProbeReport.ExitCode(
            Resolved(StoreKind.Mongo, StoreKind.Mongo, exit: true, fallbackReason: "mongo_unreachable")));
    }

    [Fact]
    public void Render_ProducesASingleLineOfValidJson()
    {
        var json = StorageProbeReport.Render(Resolved(StoreKind.Mongo, StoreKind.Mongo, exit: true, error: "boom"));

        Assert.DoesNotContain('\n', json);
        using var doc = JsonDocument.Parse(json);
        Assert.False(doc.RootElement.GetProperty("reachable").GetBoolean());
        Assert.Equal("boom", doc.RootElement.GetProperty("error").GetString());
        Assert.Equal(4, doc.RootElement.EnumerateObject().Count());
    }
}
