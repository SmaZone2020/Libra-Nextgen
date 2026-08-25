using LibraNextgen.Common.Authorization;
using LibraNextgen.Common.Models;
using Xunit;

namespace LibraNextgen.Tests;

public class CommandAuthorizationTests
{
    [Theory]
    [InlineData(CommandType.LocalAccounts)]
    [InlineData(CommandType.Kill)]
    [InlineData(CommandType.Screenshot)]
    [InlineData(CommandType.Webcam)]
    [InlineData(CommandType.KillAndClean)]
    [InlineData(CommandType.Restart)]
    public void SensitiveCommands_RequireAdmin(CommandType type)
    {
        Assert.True(CommandAuthorization.RequiresAdmin(type));
    }

    [Theory]
    [InlineData(CommandType.Shell)]
    [InlineData(CommandType.PowerShell)]
    [InlineData(CommandType.FileList)]
    [InlineData(CommandType.FileDrives)]
    [InlineData(CommandType.Proxy)]
    public void RoutineCommands_DoNotRequireAdmin(CommandType type)
    {
        Assert.False(CommandAuthorization.RequiresAdmin(type));
    }
}
