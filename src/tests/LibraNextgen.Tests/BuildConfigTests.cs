using System.Text.Json;
using LibraNextgen.Common.Models;
using Xunit;

namespace LibraNextgen.Tests;

public class BuildConfigTests
{
    [Fact]
    public void InjectedConfig_SerializesSnakeCase_MatchesRustAliases()
    {
        var cfg = new InjectedConfig
        {
            server_url = "http://127.0.0.1:5270",
            beacon_secret = "hunter2",
            rsa_private_key = "abc",
            encrypted_aes_key = "def",
        };

        var json = JsonSerializer.Serialize(cfg);
        using var doc = JsonDocument.Parse(json);

        Assert.True(doc.RootElement.TryGetProperty("server_url", out _));
        Assert.True(doc.RootElement.TryGetProperty("beacon_secret", out _));
        Assert.True(doc.RootElement.TryGetProperty("rsa_private_key", out _));
        Assert.Equal("hunter2", doc.RootElement.GetProperty("beacon_secret").GetString());
    }
}
