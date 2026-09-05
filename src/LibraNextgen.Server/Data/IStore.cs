using System.Linq.Expressions;

namespace LibraNextgen.Service.Data;

/// <summary>
/// A single field assignment. Provider-neutral counterpart of Mongo's
/// <c>$set</c> — the codebase only ever performs field-level set updates
/// (no $inc/$push/$pull), so the abstraction is intentionally limited to it.
/// See docs/desktop-electron-architecture.md for the design rationale.
/// </summary>
public readonly record struct FieldUpdate(string Field, object? Value);

/// <summary>
/// Provider-neutral document store contract implemented by both the Mongo
/// adapter (<see cref="Repository{T}"/>) and the future SQLite adapter
/// (SqliteStore). Filters are plain predicates (evaluated server-side by the
/// Mongo driver or in memory over a local SQLite document set); updates are
/// field assignments only; ordering is expressed as a property name + flag.
/// </summary>
public interface IStore<T> where T : class
{
    Task<List<T>> GetAllAsync(CancellationToken ct = default);

    Task<List<T>> FindAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default);

    /// <summary>Paged query. <paramref name="filter"/> null matches everything;
    /// <paramref name="sortField"/> null falls back to the store default
    /// (descending _id for Mongo; row insertion order for SQLite).</summary>
    Task<List<T>> FindPagedAsync(
        Expression<Func<T, bool>>? filter,
        int page,
        int pageSize,
        string? sortField = null,
        bool sortDescending = true,
        CancellationToken ct = default);

    Task<T?> GetByIdAsync(string id, CancellationToken ct = default);

    Task<T?> FirstOrDefaultAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default);

    Task<long> CountAsync(Expression<Func<T, bool>>? filter = null, CancellationToken ct = default);

    Task<bool> ExistsAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default);

    Task InsertAsync(T entity, CancellationToken ct = default);

    Task InsertManyAsync(IEnumerable<T> entities, CancellationToken ct = default);

    /// <summary>Set the listed fields on the document with the given id.
    /// Returns the number of modified documents (0 when the id does not exist
    /// or no field differs).</summary>
    Task<long> UpdateByIdAsync(string id, IReadOnlyList<FieldUpdate> updates, CancellationToken ct = default);

    /// <summary>Set the listed fields on all documents matching the filter.</summary>
    Task<long> UpdateOneAsync(Expression<Func<T, bool>> filter, IReadOnlyList<FieldUpdate> updates, CancellationToken ct = default);

    Task<long> DeleteAsync(string id, CancellationToken ct = default);

    /// <summary>Delete every document matching the filter. Returns the number
    /// of deleted documents.</summary>
    Task<long> DeleteManyAsync(Expression<Func<T, bool>> filter, CancellationToken ct = default);

    /// <summary>Atomically replace the document with the given id by
    /// <paramref name="entity"/>. The caller must keep <c>entity.Id</c> equal
    /// to <paramref name="id"/> (both backends treat the id as immutable).
    /// Returns the number of replaced documents (0 when the id does not
    /// exist).</summary>
    Task<long> ReplaceByIdAsync(string id, T entity, CancellationToken ct = default);
}
