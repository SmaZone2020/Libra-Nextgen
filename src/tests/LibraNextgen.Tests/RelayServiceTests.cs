using LibraNextgen.Service.Services;
using Xunit;

namespace LibraNextgen.Tests;

public class RelayServiceTests
{
    [Theory]
    [InlineData("creds", true)]  // 浏览器/凭据/lsass —— 最高崩溃风险，必须隔离
    [InlineData("shell", false)]
    [InlineData("files", false)]
    [InlineData("recon", false)]
    [InlineData("proxy", false)]
    [InlineData("token", false)] // 有共享状态（vault），不适配 fork 隔离
    [InlineData("script", false)]
    [InlineData("forkexec", false)]
    [InlineData("", false)]
    [InlineData("CREDS", false)] // 白名单大小写敏感，与模块名一致
    public void IsIsolatedModule_MatchesWhitelist(string module, bool expected)
    {
        Assert.Equal(expected, RelayService.IsIsolatedModule(module));
    }
}
