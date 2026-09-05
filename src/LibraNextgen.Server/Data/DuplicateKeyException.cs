namespace LibraNextgen.Service.Data;

/// <summary>
/// Thrown by any <see cref="IStore{T}"/> implementation when an insert
/// violates the unique <c>_id</c> constraint. Provider-neutral counterpart of
/// Mongo's duplicate-key error: the Mongo adapter translates
/// MongoWriteException/MongoBulkWriteException into this type, the SQLite
/// adapter throws it directly.
/// </summary>
public sealed class DuplicateKeyException : InvalidOperationException
{
    public DuplicateKeyException(string message, Exception? inner = null)
        : base(message, inner)
    {
    }
}
