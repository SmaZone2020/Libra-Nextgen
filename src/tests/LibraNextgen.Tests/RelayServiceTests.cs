using LibraNextgen.Service.Services;
using Xunit;

namespace LibraNextgen.Tests;

public class RelayServiceTests
{
    [Theory]
    [InlineData("creds", true)]
    [InlineData("shell", false)]
    [InlineData("files", false)]
    [InlineData("recon", false)]
    [InlineData("proxy", false)]
    [InlineData("token", false)]
    [InlineData("script", false)]
    [InlineData("forkexec", false)]
    [InlineData("", false)]
    [InlineData("CREDS", false)]
    public void IsIsolatedModule_MatchesWhitelist(string module, bool expected)
    {
        Assert.Equal(expected, RelayService.IsIsolatedModule(module));
    }
}
