using System.Text;
using LibraNextgen.Service.Mcp;
using Xunit;

namespace LibraNextgen.Tests;

public class McpUtilsTests
{
    [Fact]
    public void Limit_BelowCap_ReturnsInputUnchanged()
    {
        var s = new string('a', 1000);
        Assert.Equal(s, McpUtils.Limit(s));
    }

    [Fact]
    public void Limit_EmptyOrNull_ReturnsInput()
    {
        Assert.Equal("", McpUtils.Limit(""));
        Assert.Null(McpUtils.Limit(null!));
    }

    [Fact]
    public void Limit_OverCap_TruncatesToByteBudgetWithMarker()
    {
        var s = new string('a', McpUtils.MaxOutputBytes + 1000);
        var limited = McpUtils.Limit(s);
        Assert.True(limited.Length < s.Length);
        Assert.EndsWith("(output truncated)", limited);
        // Payload (without marker) stays within the byte budget.
        Assert.True(Encoding.UTF8.GetByteCount(limited) <= McpUtils.MaxOutputBytes + 32);
    }

    [Fact]
    public void Limit_NeverSplitsUtf8Sequence()
    {
        var s = new string('x', McpUtils.MaxOutputBytes - 1) + "汉汉汉";
        var limited = McpUtils.Limit(s);
        // Round-trip re-encode must be lossless: no split rune, no U+FFFD.
        var roundTripped = Encoding.UTF8.GetString(Encoding.UTF8.GetBytes(limited));
        Assert.Equal(limited, roundTripped);
        Assert.DoesNotContain('\uFFFD', limited);
    }

    [Fact]
    public void Error_ProducesStructuredJson()
    {
        var json = McpUtils.Error("boom");
        Assert.Contains("\"error\"", json);
        Assert.Contains("boom", json);
    }

    [Fact]
    public void Ok_SerializesValue()
    {
        var json = McpUtils.Ok(new { a = 1 });
        Assert.Contains("\"a\":1", json);
    }
}
