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

/// <summary>Credential flavor used to authenticate against a mesh node.</summary>
public enum MeshAuthKind
{
    Password,
    AccessKey
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
