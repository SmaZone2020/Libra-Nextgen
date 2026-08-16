using LibraNextgen.Service.Services;
using Xunit;

namespace LibraNextgen.Tests;

public class AccessKeyServiceTests
{
    [Fact]
    public void HashKey_IsDeterministic()
    {
        var a = AccessKeyService.HashKey("lnk_secret");
        var b = AccessKeyService.HashKey("lnk_secret");
        Assert.Equal(a, b);
    }

    [Fact]
    public void HashKey_DiffersForDifferentKeys()
    {
        Assert.NotEqual(
            AccessKeyService.HashKey("lnk_aaaa"),
            AccessKeyService.HashKey("lnk_bbbb"));
    }

    [Fact]
    public void HashKey_ProducesSha256Length()
    {
        // SHA-256 (32 bytes) as base64 = 44 chars
        Assert.Equal(44, AccessKeyService.HashKey("lnk_x").Length);
    }
}
