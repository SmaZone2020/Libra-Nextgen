using MongoDB.Driver;
using Microsoft.Extensions.Options;
using LibraNextgen.Service.Configuration;

namespace LibraNextgen.Service.Data;

public class MongoDbContext
{
    public IMongoDatabase Database { get; }
    public IMongoClient Client { get; }

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
