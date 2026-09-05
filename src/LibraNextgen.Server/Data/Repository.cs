using System.Globalization;
using System.Linq.Expressions;
using System.Reflection;
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
        try
        {
            await _collection.InsertOneAsync(entity, cancellationToken: ct);
        }
        catch (MongoWriteException ex) when (ex.WriteError?.Category == ServerErrorCategory.DuplicateKey)
        {
            throw new DuplicateKeyException(
                $"duplicate key in collection '{_collection.CollectionNamespace.CollectionName}'", ex);
        }
    }

    public async Task InsertManyAsync(IEnumerable<T> entities, CancellationToken ct = default)
    {
        try
        {
            await _collection.InsertManyAsync(entities, cancellationToken: ct);
        }
        catch (MongoBulkWriteException ex) when (ex.WriteErrors.Any(e => e.Category == ServerErrorCategory.DuplicateKey))
        {
            throw new DuplicateKeyException(
                $"duplicate key in collection '{_collection.CollectionNamespace.CollectionName}'", ex);
        }
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

    /// <summary>Translate field assignments into a typed Mongo update. The
    /// driver exposes only <c>Set&lt;TField&gt;(Expression&lt;Func&lt;T,TField&gt;&gt;, TField)</c>
    /// (no string-field overload in MongoDB.Driver 3.x), so each assignment is
    /// turned into a property-typed lambda; values are coerced to the property
    /// type so serialization matches hand-written lambdas.</summary>
    private UpdateDefinition<T> BuildUpdate(IReadOnlyList<FieldUpdate> updates)
    {
        var builder = Builders<T>.Update;
        var definitions = new List<UpdateDefinition<T>>(updates.Count);
        // UpdateDefinitionBuilder<T>.Set<TField>(Expression<Func<T,TField>> field, TField value)
        var setExpression = typeof(UpdateDefinitionBuilder<T>).GetMethods()
            .First(m => m.Name == nameof(UpdateDefinitionBuilder<T>.Set)
                        && m.IsGenericMethodDefinition
                        && m.GetParameters().Length == 2
                        && m.GetParameters()[0].ParameterType.IsGenericType
                        && m.GetParameters()[0].ParameterType.GetGenericTypeDefinition() == typeof(Expression<>));

        foreach (var update in updates)
        {
            var property = typeof(T).GetProperty(update.Field, BindingFlags.Public | BindingFlags.Instance | BindingFlags.IgnoreCase)
                ?? throw new InvalidOperationException($"'{update.Field}' is not a property of {typeof(T).Name}");

            var value = Coerce(update.Value, property.PropertyType);
            var parameter = Expression.Parameter(typeof(T), "x");
            var member = Expression.Property(parameter, property);
            var delegateType = typeof(Func<,>).MakeGenericType(typeof(T), property.PropertyType);
            var lambda = Expression.Lambda(delegateType, member, parameter);

            var typedSetter = setExpression.MakeGenericMethod(property.PropertyType);
            definitions.Add((UpdateDefinition<T>)typedSetter.Invoke(builder, new[] { lambda, value })!);
        }

        return definitions.Count == 1 ? definitions[0] : builder.Combine(definitions);
    }

    private static object? Coerce(object? value, Type propertyType)
    {
        if (value is null || propertyType.IsInstanceOfType(value))
            return value;
        var targetType = Nullable.GetUnderlyingType(propertyType) ?? propertyType;
        if (targetType.IsEnum)
            return Enum.Parse(targetType, value.ToString()!, ignoreCase: true);
        return Convert.ChangeType(value, targetType, CultureInfo.InvariantCulture);
    }
}
