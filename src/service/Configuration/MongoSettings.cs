namespace LibraNextgen.Service.Configuration;

public class MongoSettings
{
    public const string SectionName = "MongoDB";
    public string ConnectionString { get; set; } = "mongodb://localhost:27017";
    public string DatabaseName { get; set; } = "libra_nextgen";
    public int ConnectTimeoutSeconds { get; set; } = 10;
    public int MaxConnectionPoolSize { get; set; } = 50;
}
