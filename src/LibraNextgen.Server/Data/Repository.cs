using System.Linq.Expressions;
using MongoDB.Bson;
using MongoDB.Driver;

namespace LibraNextgen.Service.Data;

/// <summary>
/// Mongo-backed document store. Implements <see cref="IStore{T}"/> (the
/// provider-neutral contract used by SQLite mode) while keeping the original
/// Mongo-typed methods for call sites that still need them; both paths share
/// the same collection so behavior is identical.
/// </summary>
public class Repository<T> : IStore<T> where T : class
{
    private readonly IMongoCollection<T> _collection;

    public Repository(MongoDbContext context, string collectionName)
    {
        _collection = context.GetCollection<T>(collectionName);
    }

    public async Task<List<T>> GetAllAsync(CancellationToken ct = default)
    {
        return await _collection.Find(FilterDefinition<T>.Empty).ToListAsync(ct);
    }

    public async Task<List<T>> FindAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default)
    {
        return await _collection.Find(filter).ToListAsync(ct);
    }

    public async Task<List<T>> FindPagedAsync(
        FilterDefinition<T> filter,
        int page,
        int pageSize,
        SortDefinition<T>? sort = null,
        CancellationToken ct = default)
    {
        sort ??= Builders<T>.Sort.Descending("_id");
        return await _collection.Find(filter)
            .Sort(sort)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(ct);
    }

    public async Task<List<T>> FindPagedAsync(
        Expression<Func<T, bool>> filter,
        int page,
        int pageSize,
        SortDefinition<T>? sort = null,
        CancellationToken ct = default)
    {
        sort ??= Builders<T>.Sort.Descending("_id");
        return await _collection.Find(filter)
            .Sort(sort)
            .Skip((page - 1) * pageSize)
            .Limit(pageSize)
            .ToListAsync(ct);
    }

    public async Task<T?> GetByIdAsync(string id, CancellationToken ct = default)
    {
        var filter = Builders<T>.Filter.Eq("Id", id);
        return await _collection.Find(filter).FirstOrDefaultAsync(ct);
    }

    public async Task<T?> FirstOrDefaultAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default)
    {
        return await _collection.Find(filter).FirstOrDefaultAsync(ct);
    }

    public async Task InsertAsync(T entity, CancellationToken ct = default)
    {
        await _collection.InsertOneAsync(entity, cancellationToken: ct);
    }

    public async Task InsertManyAsync(IEnumerable<T> entities, CancellationToken ct = default)
    {
        await _collection.InsertManyAsync(entities, cancellationToken: ct);
    }

    public async Task<long> UpdateAsync(string id, UpdateDefinition<T> update, CancellationToken ct = default)
    {
        var filter = Builders<T>.Filter.Eq("Id", id);
        var result = await _collection.UpdateOneAsync(filter, update, cancellationToken: ct);
        return result.ModifiedCount;
    }

    public async Task<long> UpdateOneAsync(Expression<Func<T, bool>> filter, UpdateDefinition<T> update, CancellationToken ct = default)
    {
        var result = await _collection.UpdateOneAsync(filter, update, cancellationToken: ct);
        return result.ModifiedCount;
    }

    public async Task<long> DeleteAsync(string id, CancellationToken ct = default)
    {
        var filter = Builders<T>.Filter.Eq("Id", id);
        var result = await _collection.DeleteOneAsync(filter, ct);
        return result.DeletedCount;
    }

    public async Task<long> CountAsync(Expression<Func<T, bool>>? filter = null, CancellationToken ct = default)
    {
        var f = filter != null ? Builders<T>.Filter.Where(filter) : FilterDefinition<T>.Empty;
        return await _collection.CountDocumentsAsync(f, cancellationToken: ct);
    }

    public async Task<long> CountAsync(FilterDefinition<T> filter, CancellationToken ct = default)
    {
        return await _collection.CountDocumentsAsync(filter, cancellationToken: ct);
    }

    public async Task<bool> ExistsAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default)
    {
        return await _collection.Find(filter).AnyAsync(ct);
    }

    // ── IStore<T> provider-neutral surface ────────────────────────────────
    // These overloads translate the neutral contract onto the Mongo driver.
    // They exist alongside the Mongo-typed methods above; services migrate to
    // the neutral surface per collection when the SQLite adapter lands (P1+).

    public async Task<List<T>> FindPagedAsync(
        Expression<Func<T, bool>>? filter,
        int page,
        int pageSize,
        string? sortField = null,
        bool sortDescending = true,
        CancellationToken ct = default)
    {
        var f = filter != null ? Builders<T>.Filter.Where(filter) : FilterDefinition<T>.Empty;
        // String field names are translated through the class map by the
        // driver, so "Id" reaches the _id element exactly like Eq("Id") above.
        var sort = string.IsNullOrEmpty(sortField)
            ? Builders<T>.Sort.Descending("_id")
            : sortDescending
                ? Builders<T>.Sort.Descending(sortField)
                : Builders<T>.Sort.Ascending(sortField);
        return await FindPagedAsync(f, page, pageSize, sort, ct);
    }

    public async Task<long> UpdateByIdAsync(string id, IReadOnlyList<FieldUpdate> updates, CancellationToken ct = default)
    {
        if (updates.Count == 0)
            return 0;
        var filter = Builders<T>.Filter.Eq("Id", id);
        var result = await _collection.UpdateOneAsync(filter, BuildUpdate(updates), cancellationToken: ct);
        return result.ModifiedCount;
    }

    public async Task<long> UpdateOneAsync(Expression<Func<T, bool>> filter, IReadOnlyList<FieldUpdate> updates, CancellationToken ct = default)
    {
        if (updates.Count == 0)
            return 0;
        var result = await _collection.UpdateOneAsync(
            Builders<T>.Filter.Where(filter), BuildUpdate(updates), cancellationToken: ct);
        return result.ModifiedCount;
    }

    /// <summary>Translate field assignments into a typed Mongo update so each
    /// value is serialized with the serializer of its runtime type (identical
    /// to writing the lambdas by hand).</summary>
    private UpdateDefinition<T> BuildUpdate(IReadOnlyList<FieldUpdate> updates)
    {
        var builder = Builders<T>.Update;
        var definitions = new List<UpdateDefinition<T>>(updates.Count);
        // UpdateDefinitionBuilder<T>.Set<TField>(string field, TField value)
        var setter = typeof(UpdateDefinitionBuilder<T>).GetMethods()
            .First(m => m.Name == nameof(UpdateDefinitionBuilder<T>.Set)
                        && m.IsGenericMethodDefinition
                        && m.GetParameters().Length == 2
                        && m.GetParameters()[0].ParameterType == typeof(string)
                        && m.GetParameters()[1].ParameterType.IsGenericParameter);

        foreach (var update in updates)
        {
            if (update.Value is null)
            {
                definitions.Add(builder.Set(update.Field, BsonNull.Value));
                continue;
            }
            var typedSetter = setter.MakeGenericMethod(update.Value.GetType());
            definitions.Add((UpdateDefinition<T>)typedSetter.Invoke(builder, new[] { update.Field, update.Value })!);
        }

        return definitions.Count == 1 ? definitions[0] : builder.Combine(definitions);
    }
}
