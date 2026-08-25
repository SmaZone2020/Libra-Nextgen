namespace LibraNextgen.Common.Models;

public enum AgentStatus
{
    Online,
    Offline,
    Sleeping,
    Compromised
}

public enum TaskStatus
{
    Pending,
    Sent,
    Running,
    Completed,
    Failed,
    Cancelled
}

public enum UserRole
{
    Operator,
    Admin
}

public enum CommandType
{
    Shell,
    PowerShell,
    CredDump,
    LocalAccounts,
    Upload,
    Download,
    WifiScan,
    Kill,
    Sleep,
    Proxy,
    FileList,
    FileDrives,
    /// 通用模块执行：Command = 模块名（files/recon/creds/proxy/token/script…），
    /// Arguments[0] = 模块输入 JSON。REST relay 任务化的基础。
    Generic,
    KillAndClean,
    Restart
}
