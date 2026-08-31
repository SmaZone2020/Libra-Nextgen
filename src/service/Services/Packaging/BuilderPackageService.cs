namespace LibraNextgen.Service.Services.Packaging;

/// <summary>
/// </summary>
public static class BuilderPackageService
{
    public static byte[] CreateLnk(string artifactUrl) =>
        LnkWriter.CreateDownloadAndRun(artifactUrl);
}
