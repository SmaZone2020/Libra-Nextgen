namespace LibraNextgen.Agent.Modules.Execution;

public static class FileOps
{
    public static string ListDirectory(string path)
    {
        try
        {
            var dir = new DirectoryInfo(path);
            if (!dir.Exists) return """{"error":"Directory not found"}""";

            var entries = dir.GetFileSystemInfos().Select(f =>
                $$"""{"name":"{{Esc(f.Name)}}","type":"{{(f is DirectoryInfo ? "dir" : "file")}}","size":{{(f is FileInfo fi ? fi.Length : 0)}},"modified":"{{f.LastWriteTimeUtc:o}}","attributes":"{{f.Attributes}}"}""");

            return $$"""{"path":"{{Esc(path)}}","entries":[{{string.Join(",", entries)}}]}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string ReadFile(string path)
    {
        try
        {
            if (!File.Exists(path)) return """{"error":"File not found"}""";
            var bytes = File.ReadAllBytes(path);
            var base64 = Convert.ToBase64String(bytes);
            return $$"""{"path":"{{Esc(path)}}","size":{{bytes.Length}},"content":"{{base64}}"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string WriteFile(string path, string base64Content)
    {
        try
        {
            var bytes = Convert.FromBase64String(base64Content);
            File.WriteAllBytes(path, bytes);
            return $$"""{"path":"{{Esc(path)}}","size":{{bytes.Length}},"status":"written"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string DeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
                return $$"""{"path":"{{Esc(path)}}","status":"deleted"}""";
            }
            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
                return $$"""{"path":"{{Esc(path)}}","status":"deleted"}""";
            }
            return """{"error":"Path not found"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string CreateDirectory(string path)
    {
        try
        {
            Directory.CreateDirectory(path);
            return $$"""{"path":"{{Esc(path)}}","status":"created"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
