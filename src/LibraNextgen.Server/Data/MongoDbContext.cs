using MongoDB.Bson.Serialization;
using MongoDB.Driver;
using Microsoft.Extensions.Options;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Data;

public class MongoDbContext
{
    public IMongoDatabase Database { get; }
    public IMongoClient Client { get; }

    // The check-then-register below is not atomic: xUnit runs test classes in
    // parallel, and concurrent first touches used to double-register AccessKey
    // (ArgumentException: An item with the same key has already been added).
    private static readonly object ClassMapLock = new();

    static MongoDbContext()
    {
        // AccessKey previously stored the raw `Key`; the field was renamed to
        // KeyHash. Ignore extra elements so legacy documents still deserialize.
        lock (ClassMapLock)
        {
            if (!BsonClassMap.IsClassMapRegistered(typeof(AccessKey)))
            {
                BsonClassMap.RegisterClassMap<AccessKey>(cm =>
                {
                    cm.AutoMap();
                    cm.SetIgnoreExtraElements(true);
                });
            }
        }
    }

    public MongoDbContext(IOptions<MongoSettings> settings)
    {
        var s = settings.Value;
        var clientSettings = MongoClientSettings.FromConnectionString(s.ConnectionString);
        clientSettings.ConnectTimeout = TimeSpan.FromSeconds(s.ConnectTimeoutSeconds);
        clientSettings.MaxConnectionPoolSize = s.MaxConnectionPoolSize;
        if (s.UseTls)
            clientSettings.UseTls = true;

        Client = new MongoClient(clientSettings);
        Database = Client.GetDatabase(s.DatabaseName);
    }

    public IMongoCollection<T> GetCollection<T>(string name)
    {
        return Database.GetCollection<T>(name);
    }
}
