using System.Text.Json;
using LibraNextgen.Common.Models;
using LibraNextgen.Service.Models;
using LibraNextgen.Service.Services;
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
            core_download_path = "/api/beacon/core/abc",
            core_key_path = "/api/beacon/core-key",
        };

        var json = JsonSerializer.Serialize(cfg);
        using var doc = JsonDocument.Parse(json);

        Assert.True(doc.RootElement.TryGetProperty("server_url", out _));
        Assert.True(doc.RootElement.TryGetProperty("beacon_secret", out _));
        Assert.True(doc.RootElement.TryGetProperty("core_key_path", out _));
        Assert.False(doc.RootElement.TryGetProperty("rsa_private_key", out _));
        Assert.Equal("hunter2", doc.RootElement.GetProperty("beacon_secret").GetString());
    }

    [Theory]
    [InlineData(null, null, 3000ul, 0.2)]
    [InlineData(0ul, -0.5, 500ul, 0.0)]
    [InlineData(90000ul, 5.0, 60000ul, 0.9)]
    [InlineData(1500ul, 0.35, 1500ul, 0.35)]
    public void ResolveConnectionTiming_ClampsToSafeRange(ulong? ms, double? jitter, ulong expectedMs, double expectedJitter)
    {
        var req = new BuildConfigRequest
        {
            HeartbeatIntervalMs = ms,
            JitterPercent = jitter,
        };

        var (heartbeatMs, jitterRes) = BuilderBuildService.ResolveConnectionTiming(req);

        Assert.Equal(expectedMs, heartbeatMs);
        Assert.Equal(expectedJitter, jitterRes, precision: 6);
    }

    [Theory]
    [InlineData(null, "/api/beacon/register")]
    [InlineData("", "/api/beacon/register")]
    [InlineData("   ", "/api/beacon/register")]
    [InlineData("/custom/reg", "/custom/reg")]
    [InlineData("  /api/x  ", "/api/x")]
    public void ResolvePath_FallsBackToDefault_WhenBlank(string? value, string expected)
    {
        Assert.Equal(expected, BuilderBuildService.ResolvePath(value, "/api/beacon/register"));
    }
}
