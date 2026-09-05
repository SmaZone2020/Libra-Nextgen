using System.Collections.Concurrent;
using System.Globalization;
using System.Linq.Expressions;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Data.Sqlite;

namespace LibraNextgen.Service.Data;

/// <summary>
/// SQLite document-store engine. One table per collection
/// (<c>_id TEXT PRIMARY KEY, doc TEXT NOT NULL</c>) holding the whole model
/// serialized as JSON; rowid provides insertion order, used as the default
/// paging order. Filters and sort fields are evaluated in memory over
/// deserialized documents — the right trade for the single-machine desktop
/// data volumes this store serves (docs/desktop-electron-architecture.md §5).
/// Schema evolution is tracked with <c>PRAGMA user_version</c>.
/// </summary>
public sealed class SqliteDbContext : IDisposable
{
    private readonly string _connectionString;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public string DbPath { get; }

    public SqliteDbContext(string dbPath)
    {
        DbPath = Path.GetFullPath(dbPath);
        var dir = Path.GetDirectoryName(DbPath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = DbPath,
            Mode = SqliteOpenMode.ReadWriteCreate,
            Cache = SqliteCacheMode.Shared,
            Pooling = true,
        }.ToString();

        using var conn = OpenConnection();
        Exec(conn, "PRAGMA journal_mode=WAL;");
        if (GetUserVersion(conn) < 1)
        {
            // v1: no structural migrations yet — collection tables are created
            // on first use. user_version is the hook for future schema changes
            // (e.g. extracted index columns for hot query paths).
            SetUserVersion(conn, 1);
        }
    }

    /// <summary>Serialize every operation through one gate; SQLite is a
    /// single-writer engine and desktop traffic is modest, so simplicity wins
    /// over read concurrency here.</summary>
    internal async Task<T> RunAsync<T>(Func<SqliteConnection, T> body)
    {
        await _gate.WaitAsync();
        try
        {
            using var conn = OpenConnection();
            return body(conn);
        }
        finally
        {
            _gate.Release();
        }
    }

    internal SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection(_connectionString);
        conn.Open();
        Exec(conn, "PRAGMA busy_timeout=5000;");
        return conn;
    }

    internal static void Exec(SqliteConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private static int GetUserVersion(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "PRAGMA user_version;";
        return Convert.ToInt32(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
    }

    private static void SetUserVersion(SqliteConnection conn, int version)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"PRAGMA user_version = {version};";
        cmd.ExecuteNonQuery();
    }

    public void Dispose() => _gate.Dispose();
}

/// <summary>Sqlite-backed implementation of <see cref="IStore{T}"/>.</summary>
public sealed class SqliteStore<T> : IStore<T> where T : class
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNameCaseInsensitive = true,
        // Full-fidelity round trips: nulls/defaults must persist so that
        // field-level updates never silently drop data.
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    // Property lookup cache per (entity type, field name).
    private static readonly ConcurrentDictionary<(Type, string), PropertyInfo?> PropertyCache = new();

    private static readonly IComparer<object?> NullableComparer =
        Comparer<object?>.Create(static (a, b) => CompareValues(a, b));

    private readonly SqliteDbContext _db;
    private readonly string _table;
    private readonly string _quoted;

    public SqliteStore(SqliteDbContext db, string collectionName)
    {
        _db = db;
        _table = collectionName;
        _quoted = "\"" + collectionName.Replace("\"", "\"\"") + "\"";
        _db.RunAsync(conn =>
        {
            SqliteDbContext.Exec(conn, $"CREATE TABLE IF NOT EXISTS {_quoted} (_id TEXT PRIMARY KEY, doc TEXT NOT NULL);");
            return true;
        }).GetAwaiter().GetResult();
    }

    // ── IStore<T> ────────────────────────────────────────────────────────

    public Task<List<T>> GetAllAsync(CancellationToken ct = default)
        => _db.RunAsync(conn => LoadAll(conn));

    public Task<List<T>> FindAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            var predicate = filter.Compile();
            return LoadAll(conn).Where(predicate).ToList();
        });

    public Task<List<T>> FindPagedAsync(
        Expression<Func<T, bool>>? filter,
        int page,
        int pageSize,
        string? sortField = null,
        bool sortDescending = true,
        CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            var all = LoadAll(conn);
            var predicate = filter?.Compile();
            IEnumerable<T> matched = predicate is null ? all : all.Where(predicate);

            List<T> ordered = string.IsNullOrEmpty(sortField)
                ? matched.ToList() // insertion order (rowid)
                : ApplySort(matched, sortField!, sortDescending);

            return ordered
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToList();
        });

    public Task<T?> GetByIdAsync(string id, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT doc FROM {_quoted} WHERE _id = $id;";
            cmd.Parameters.AddWithValue("$id", id);
            var value = cmd.ExecuteScalar();
            return value is null or DBNull ? null : Deserialize((string)value);
        });

    public Task<T?> FirstOrDefaultAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default)
        => _db.RunAsync(conn => LoadAll(conn).FirstOrDefault(filter.Compile()));

    public Task<long> CountAsync(Expression<Func<T, bool>>? filter = null, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            if (filter is null)
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = $"SELECT COUNT(*) FROM {_quoted};";
                return Convert.ToInt64(cmd.ExecuteScalar(), CultureInfo.InvariantCulture);
            }
            var predicate = filter.Compile();
            return LoadAll(conn).LongCount(predicate);
        });

    public Task<bool> ExistsAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default)
        => _db.RunAsync(conn => LoadAll(conn).Any(filter.Compile()));

    public Task InsertAsync(T entity, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            InsertOne(conn, entity);
            return true;
        });

    public Task InsertManyAsync(IEnumerable<T> entities, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            foreach (var entity in entities)
                InsertOne(conn, entity);
            return true;
        });

    public Task<long> UpdateByIdAsync(string id, IReadOnlyList<FieldUpdate> updates, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            if (updates.Count == 0)
                return 0L;
            var current = LoadById(conn, id);
            if (current is null)
                return 0L;
            return PersistIfChanged(conn, id, current, updates);
        });

    public Task<long> UpdateOneAsync(Expression<Func<T, bool>> filter, IReadOnlyList<FieldUpdate> updates, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            if (updates.Count == 0)
                return 0L;
            var predicate = filter.Compile();
            long modified = 0;
            foreach (var entity in LoadAll(conn).Where(predicate))
                modified += PersistIfChanged(conn, EntityId(entity), entity, updates);
            return modified;
        });

    public Task<long> DeleteAsync(string id, CancellationToken ct = default)
        => _db.RunAsync(conn =>
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"DELETE FROM {_quoted} WHERE _id = $id;";
            cmd.Parameters.AddWithValue("$id", id);
            return (long)cmd.ExecuteNonQuery();
        });

    // ── internals ────────────────────────────────────────────────────────

    private static string EntityId(T entity)
    {
        var prop = FindProperty("Id") ?? throw new InvalidOperationException(
            $"{typeof(T).Name} has no 'Id' property; SQLite store requires a string Id.");
        return (prop.GetValue(entity) as string)
            ?? throw new InvalidOperationException($"{typeof(T).Name}.Id must be a non-null string.");
    }

    private static string Serialize(T entity) => JsonSerializer.Serialize(entity, Json);

    private static T Deserialize(string json)
        => JsonSerializer.Deserialize<T>(json, Json)
           ?? throw new InvalidOperationException($"stored document deserialized to null: {json[..Math.Min(json.Length, 80)]}");

    private List<T> LoadAll(SqliteConnection conn)
    {
        var result = new List<T>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT doc FROM {_quoted} ORDER BY rowid;";
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
            result.Add(Deserialize(reader.GetString(0)));
        return result;
    }

    private T? LoadById(SqliteConnection conn, string id)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT doc FROM {_quoted} WHERE _id = $id;";
        cmd.Parameters.AddWithValue("$id", id);
        var value = cmd.ExecuteScalar();
        return value is null or DBNull ? null : Deserialize((string)value);
    }

    private void InsertOne(SqliteConnection conn, T entity)
    {
        var id = EntityId(entity);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"INSERT INTO {_quoted} (_id, doc) VALUES ($id, $doc);";
        cmd.Parameters.AddWithValue("$id", id);
        cmd.Parameters.AddWithValue("$doc", Serialize(entity));
        try
        {
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 19) // SQLITE_CONSTRAINT
        {
            throw new DuplicateKeyException($"duplicate _id '{id}' in collection '{_table}'", ex);
        }
    }

    /// <summary>Apply field updates; persist only when the serialized document
    /// actually changed and return 1 (mirrors Mongo ModifiedCount semantics).</summary>
    private long PersistIfChanged(SqliteConnection conn, string id, T entity, IReadOnlyList<FieldUpdate> updates)
    {
        var before = Serialize(entity);
        foreach (var update in updates)
            ApplyField(update.Field, update.Value, entity);
        var after = Serialize(entity);
        if (before == after)
            return 0;

        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"UPDATE {_quoted} SET doc = $doc WHERE _id = $id;";
        cmd.Parameters.AddWithValue("$doc", after);
        cmd.Parameters.AddWithValue("$id", id);
        cmd.ExecuteNonQuery();
        return 1;
    }

    private static void ApplyField(string field, object? value, T target)
    {
        var property = FindProperty(field)
            ?? throw new InvalidOperationException($"'{field}' is not a property of {typeof(T).Name}");
        if (value is null)
        {
            property.SetValue(target, null);
            return;
        }
        var type = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
        if (type.IsInstanceOfType(value))
        {
            property.SetValue(target, value);
            return;
        }
        if (type.IsEnum)
        {
            property.SetValue(target, Enum.Parse(type, value.ToString()!, ignoreCase: true));
            return;
        }
        property.SetValue(target, Convert.ChangeType(value, type, CultureInfo.InvariantCulture));
    }

    private static PropertyInfo? FindProperty(string name)
        => PropertyCache.GetOrAdd((typeof(T), name), static key =>
        {
            var type = key.Item1;
            return type.GetProperty(key.Item2, BindingFlags.Public | BindingFlags.Instance)
                   ?? type.GetProperties(BindingFlags.Public | BindingFlags.Instance)
                       .FirstOrDefault(p => string.Equals(p.Name, key.Item2, StringComparison.OrdinalIgnoreCase));
        });

    private static List<T> ApplySort(IEnumerable<T> items, string sortField, bool descending)
    {
        var property = FindProperty(sortField)
            ?? throw new InvalidOperationException($"'{sortField}' is not a property of {typeof(T).Name}");
        var ordered = descending
            ? items.OrderByDescending(x => property.GetValue(x), NullableComparer)
            : items.OrderBy(x => property.GetValue(x), NullableComparer);
        return ordered.ToList();
    }

    private static int CompareValues(object? a, object? b)
    {
        if (a is null && b is null)
            return 0;
        if (a is null)
            return -1;
        if (b is null)
            return 1;
        return a is IComparable comparable
            ? comparable.CompareTo(b)
            : string.Compare(a.ToString(), b.ToString(), StringComparison.Ordinal);
    }
}
