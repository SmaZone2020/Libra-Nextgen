using System.Linq.Expressions;
using MongoDB.Driver;

namespace LibraNextgen.Service.Data;

public class Repository<T> where T : class
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
}
