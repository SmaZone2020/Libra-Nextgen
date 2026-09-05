using LibraNextgen.Service.Data;
using LibraNextgen.Service.Services.Platform;
using Xunit;

namespace LibraNextgen.Tests;

/// <summary>Plain POCO exercising the document-store paths (string Id,
/// value/string/enum-like fields, list field, timestamps).</summary>
public class SqliteDoc
{
    public string Id { get; set; } = "";
    public string? Name { get; set; }
    public int Rank { get; set; }
    public DateTime CreatedAt { get; set; }
    public List<string>? Tags { get; set; }
}

public class SqliteStoreTests : IDisposable
{
    private readonly SqliteDbContext _db;
    private readonly SqliteStore<SqliteDoc> _store;
    private readonly string _path;

    public SqliteStoreTests()
    {
        _path = Path.Combine(Path.GetTempPath(), "libra-tests", $"{Guid.NewGuid():N}.db");
        _db = new SqliteDbContext(_path);
        _store = new SqliteStore<SqliteDoc>(_db, "docs_test");
    }

    public void Dispose()
    {
        _db.Dispose();
        foreach (var suffix in new[] { "", "-wal", "-shm" })
        {
            try { File.Delete(_path + suffix); } catch { /* best effort */ }
        }
    }

    private static SqliteDoc Doc(string id, string? name = null, int rank = 0, DateTime? createdAt = null, List<string>? tags = null) => new()
    {
        Id = id,
        Name = name,
        Rank = rank,
        CreatedAt = createdAt ?? DateTime.UtcNow,
        Tags = tags,
    };

    [Fact]
    public async Task InsertThenGetById_RoundTrips()
    {
        await _store.InsertAsync(Doc("a", "alpha", 1));
        var found = await _store.GetByIdAsync("a");
        Assert.NotNull(found);
        Assert.Equal("alpha", found!.Name);
        Assert.Equal(1, found.Rank);
    }

    [Fact]
    public async Task Insert_DuplicateId_Throws()
    {
        await _store.InsertAsync(Doc("a"));
        await Assert.ThrowsAsync<DuplicateKeyException>(() => _store.InsertAsync(Doc("a", "dup")));
    }

    [Fact]
    public async Task Find_FilterMatchesInMemory()
    {
        await _store.InsertManyAsync(new[]
        {
            Doc("a", "alpha", 1, tags: new List<string> { "x", "y" }),
            Doc("b", "beta", 2),
            Doc("c", "gamma", 3, tags: new List<string> { "y" }),
        });

        var ranked = await _store.FindAsync(d => d.Rank >= 2);
        Assert.Equal(new[] { "b", "c" }, ranked.Select(d => d.Id).ToArray());

        var tagged = await _store.FindAsync(d => d.Tags != null && d.Tags.Contains("y"));
        Assert.Equal(new[] { "a", "c" }, tagged.Select(d => d.Id).ToArray());
    }

    [Fact]
    public async Task Count_WithAndWithoutFilter()
    {
        await _store.InsertManyAsync(new[] { Doc("a", rank: 1), Doc("b", rank: 2), Doc("c", rank: 2) });
        Assert.Equal(3, await _store.CountAsync());
        Assert.Equal(2, await _store.CountAsync(d => d.Rank == 2));
    }

    [Fact]
    public async Task Exists_ReflectsMembership()
    {
        await _store.InsertAsync(Doc("a"));
        Assert.True(await _store.ExistsAsync(d => d.Id == "a"));
        Assert.False(await _store.ExistsAsync(d => d.Id == "missing"));
    }

    [Fact]
    public async Task FirstOrDefault_ReturnsFirstMatchOrNull()
    {
        await _store.InsertManyAsync(new[] { Doc("a", "alpha"), Doc("b", "beta") });
        var found = await _store.FirstOrDefaultAsync(d => d.Name == "beta");
        Assert.NotNull(found);
        Assert.Equal("b", found!.Id);
        Assert.Null(await _store.FirstOrDefaultAsync(d => d.Name == "nope"));
    }

    [Fact]
    public async Task UpdateById_SetsFields_AndReportsModifiedCount()
    {
        await _store.InsertAsync(Doc("a", "alpha", 1));
        var epoch = DateTime.UtcNow;

        var modified = await _store.UpdateByIdAsync("a", new[]
        {
            new FieldUpdate(nameof(SqliteDoc.Name), "renamed"),
            new FieldUpdate(nameof(SqliteDoc.Rank), 42),
            new FieldUpdate(nameof(SqliteDoc.CreatedAt), epoch),
        });
        Assert.Equal(1, modified);

        var reloaded = await _store.GetByIdAsync("a");
        Assert.Equal("renamed", reloaded!.Name);
        Assert.Equal(42, reloaded.Rank);
        Assert.Equal(epoch, reloaded.CreatedAt);

        // Same values again -> nothing modified.
        Assert.Equal(0, await _store.UpdateByIdAsync("a", new[] { new FieldUpdate(nameof(SqliteDoc.Rank), 42) }));
        // Missing id -> 0.
        Assert.Equal(0, await _store.UpdateByIdAsync("nope", new[] { new FieldUpdate(nameof(SqliteDoc.Rank), 1) }));
    }

    [Fact]
    public async Task UpdateById_NullValue_ClearsField()
    {
        await _store.InsertAsync(Doc("a", "alpha"));
        Assert.Equal(1, await _store.UpdateByIdAsync("a", new[] { new FieldUpdate(nameof(SqliteDoc.Name), null) }));
        Assert.Null((await _store.GetByIdAsync("a"))!.Name);
    }

    [Fact]
    public async Task UpdateOne_ByFilter_UpdatesMatchingRows()
    {
        await _store.InsertManyAsync(new[]
        {
            Doc("a", null, 1),
            Doc("b", null, 1),
            Doc("c", "keep", 2),
        });

        var modified = await _store.UpdateOneAsync(d => d.Rank == 1, new[] { new FieldUpdate(nameof(SqliteDoc.Name), "batch") });
        Assert.Equal(2, modified);
        Assert.Equal("keep", (await _store.GetByIdAsync("c"))!.Name);
    }

    [Fact]
    public async Task FindPaged_DefaultOrderIsInsertionOrder()
    {
        await _store.InsertManyAsync(new[] { Doc("a"), Doc("b"), Doc("c"), Doc("d") });
        var page1 = await _store.FindPagedAsync(null, 1, 2);
        var page2 = await _store.FindPagedAsync(null, 2, 2);
        Assert.Equal(new[] { "a", "b" }, page1.Select(d => d.Id).ToArray());
        Assert.Equal(new[] { "c", "d" }, page2.Select(d => d.Id).ToArray());
    }

    [Fact]
    public async Task FindPaged_SortsByFieldAscendingAndDescending()
    {
        var baseTime = DateTime.UtcNow;
        await _store.InsertManyAsync(new[]
        {
            Doc("a", rank: 1, createdAt: baseTime.AddSeconds(1)),
            Doc("b", rank: 3, createdAt: baseTime.AddSeconds(3)),
            Doc("c", rank: 2, createdAt: baseTime.AddSeconds(2)),
        });

        var desc = await _store.FindPagedAsync(null, 1, 10, nameof(SqliteDoc.Rank), sortDescending: true);
        Assert.Equal(new[] { "b", "c", "a" }, desc.Select(d => d.Id).ToArray());

        var asc = await _store.FindPagedAsync(null, 1, 10, nameof(SqliteDoc.CreatedAt), sortDescending: false);
        Assert.Equal(new[] { "a", "c", "b" }, asc.Select(d => d.Id).ToArray());
    }

    [Fact]
    public async Task Delete_RemovesById()
    {
        await _store.InsertAsync(Doc("a"));
        Assert.Equal(1, await _store.DeleteAsync("a"));
        Assert.Equal(0, await _store.DeleteAsync("a"));
        Assert.Null(await _store.GetByIdAsync("a"));
    }

    [Fact]
    public async Task GetAll_ReturnsInInsertionOrder()
    {
        await _store.InsertManyAsync(new[] { Doc("a"), Doc("b"), Doc("c") });
        var all = await _store.GetAllAsync();
        Assert.Equal(new[] { "a", "b", "c" }, all.Select(d => d.Id).ToArray());
    }

    [Fact]
    public async Task UnknownFieldOnUpdate_Throws()
    {
        await _store.InsertAsync(Doc("a"));
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            _store.UpdateByIdAsync("a", new[] { new FieldUpdate("NoSuchField", 1) }));
    }

    [Fact]
    public async Task PurgeOlderThan_DeletesOnlyStaleDocs()
    {
        var now = DateTime.UtcNow;
        await _store.InsertManyAsync(new[]
        {
            Doc("old1", createdAt: now.AddDays(-10)),
            Doc("old2", createdAt: now.AddDays(-20)),
            Doc("new1", createdAt: now),
        });

        var purged = await StoreTtlCleanupService.PurgeOlderThanAsync(_store, d => d.CreatedAt, now.AddDays(-5));

        Assert.Equal(2, purged);
        Assert.Null(await _store.GetByIdAsync("old1"));
        Assert.Null(await _store.GetByIdAsync("old2"));
        Assert.NotNull(await _store.GetByIdAsync("new1"));
    }
}
