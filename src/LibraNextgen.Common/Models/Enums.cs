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
    Generic,
    KillAndClean,
    Restart
}
