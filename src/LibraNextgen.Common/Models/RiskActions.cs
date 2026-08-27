namespace LibraNextgen.Common.Models;

/// <summary>
/// Canonical action keys used to classify audited operations, and the default
/// risk mappings. Admins can override the mappings from the console settings.
/// </summary>
public static class RiskActions
{
    public const string SystemInfo = "system.info";
    public const string SystemProcesses = "system.processes";
    public const string SystemProcessKill = "system.process.kill";
    public const string SystemWindows = "system.windows";
    public const string SystemEnv = "system.env";
    public const string SystemNetwork = "system.network";
    public const string SystemLanScan = "system.lanscan";
    public const string ScreenMonitor = "screen.monitor";
    public const string Camera = "media.camera";
    public const string Mic = "media.mic";
    public const string FileDrives = "file.drives";
    public const string FileList = "file.list";
    public const string FileRead = "file.read";
    public const string FileWrite = "file.write";
    public const string FileDelete = "file.delete";
    public const string FileMkdir = "file.mkdir";
    public const string FileRename = "file.rename";
    public const string FileMove = "file.move";
    public const string FileCopy = "file.copy";
    public const string FileCompress = "file.compress";
    public const string FileDecompress = "file.decompress";
    public const string FileShortcut = "file.shortcut";
    public const string Shell = "shell.command";
    public const string Wechat = "othersoft.wechat";
    public const string Browser = "othersoft.browser";
    public const string BrowserSearch = "othersoft.browser.search";
    public const string Ai = "othersoft.ai";
    public const string Credentials = "credentials";
    public const string Proxy = "proxy.fetch";
    public const string AccountManage = "account.manage";
    public const string AccessKeyManage = "accesskey.manage";
    public const string BuilderBuild = "builder.build";
    public const string AgentDelete = "agent.delete";
    public const string AgentKillAll = "agent.kill_all";
    public const string ProcessSpawn = "process.spawn";
    public const string TaskCreate = "task.create";
    public const string Login = "auth.login";

    public static Dictionary<string, RiskLevel> DefaultMappings() => new()
    {
        [SystemInfo] = RiskLevel.Safe,
        [SystemProcesses] = RiskLevel.Safe,
        [SystemWindows] = RiskLevel.Safe,
        [SystemEnv] = RiskLevel.Safe,
        [SystemNetwork] = RiskLevel.Safe,
        [SystemLanScan] = RiskLevel.Safe,
        [Wechat] = RiskLevel.Safe,
        [FileList] = RiskLevel.Normal,
        [FileRead] = RiskLevel.Normal,
        [FileDrives] = RiskLevel.Normal,
        [Shell] = RiskLevel.Normal,
        [Proxy] = RiskLevel.Normal,
        [TaskCreate] = RiskLevel.Normal,
        [Login] = RiskLevel.Normal,
        [ScreenMonitor] = RiskLevel.Dangerous,
        [Camera] = RiskLevel.Dangerous,
        [Mic] = RiskLevel.Dangerous,
        [FileWrite] = RiskLevel.Dangerous,
        [FileDelete] = RiskLevel.Dangerous,
        [FileMkdir] = RiskLevel.Dangerous,
        [FileRename] = RiskLevel.Dangerous,
        [FileMove] = RiskLevel.Dangerous,
        [FileCopy] = RiskLevel.Dangerous,
        [FileCompress] = RiskLevel.Dangerous,
        [FileDecompress] = RiskLevel.Dangerous,
        [FileShortcut] = RiskLevel.Dangerous,
        [SystemProcessKill] = RiskLevel.Dangerous,
        [ProcessSpawn] = RiskLevel.Dangerous,
        [Browser] = RiskLevel.Dangerous,
        [BrowserSearch] = RiskLevel.Dangerous,
        [AccountManage] = RiskLevel.Dangerous,
        [AccessKeyManage] = RiskLevel.Dangerous,
        [BuilderBuild] = RiskLevel.Dangerous,
        [AgentDelete] = RiskLevel.Dangerous,
        [AgentKillAll] = RiskLevel.Dangerous,
        [Ai] = RiskLevel.Malicious,
        [Credentials] = RiskLevel.Malicious,
    };
}
