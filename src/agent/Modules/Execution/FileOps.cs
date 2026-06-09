using System.Text.Json;

namespace LibraNextgen.Agent.Modules.Execution;

public static class FileOps
{
    public static string ListDirectory(string path)
    {
        try
        {
            var dir = new DirectoryInfo(path);
            if (!dir.Exists) return JsonSerializer.Serialize(new { error = "Directory not found" });

            var entries = dir.GetFileSystemInfos().Select(f => new
            {
                name = f.Name,
                type = f is DirectoryInfo ? "dir" : "file",
                size = f is FileInfo fi ? fi.Length : 0,
                modified = f.LastWriteTimeUtc.ToString("o"),
                attributes = f.Attributes.ToString()
            }).ToArray();

            return JsonSerializer.Serialize(new { path, entries });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message });
        }
    }

    public static string ReadFile(string path)
    {
        try
        {
            if (!File.Exists(path)) return JsonSerializer.Serialize(new { error = "File not found" });

            var bytes = File.ReadAllBytes(path);
            var base64 = Convert.ToBase64String(bytes);
            return JsonSerializer.Serialize(new { path, size = bytes.Length, content = base64 });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message });
        }
    }

    public static string WriteFile(string path, string base64Content)
    {
        try
        {
            var bytes = Convert.FromBase64String(base64Content);
            File.WriteAllBytes(path, bytes);
            return JsonSerializer.Serialize(new { path, size = bytes.Length, status = "written" });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message });
        }
    }

    public static string DeleteFile(string path)
    {
        try
        {
            if (File.Exists(path))
            {
                File.Delete(path);
                return JsonSerializer.Serialize(new { path, status = "deleted" });
            }

            if (Directory.Exists(path))
            {
                Directory.Delete(path, true);
                return JsonSerializer.Serialize(new { path, status = "deleted" });
            }

            return JsonSerializer.Serialize(new { error = "Path not found" });
        }
        catch (Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message });
        }
    }
}
