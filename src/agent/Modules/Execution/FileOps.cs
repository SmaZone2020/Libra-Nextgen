using System.IO.Compression;

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

    public static string Rename(string path, string newName)
    {
        try
        {
            var parent = Path.GetDirectoryName(path) ?? "";
            var dest = Path.Combine(parent, newName);
            if (File.Exists(path))
            {
                File.Move(path, dest);
                return $$"""{"path":"{{Esc(dest)}}","status":"renamed"}""";
            }
            if (Directory.Exists(path))
            {
                Directory.Move(path, dest);
                return $$"""{"path":"{{Esc(dest)}}","status":"renamed"}""";
            }
            return """{"error":"Path not found"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string Move(string source, string destination)
    {
        try
        {
            if (File.Exists(source))
            {
                var dest = Directory.Exists(destination)
                    ? Path.Combine(destination, Path.GetFileName(source))
                    : destination;
                File.Move(source, dest, true);
                return $$"""{"path":"{{Esc(dest)}}","status":"moved"}""";
            }
            if (Directory.Exists(source))
            {
                var dest = Directory.Exists(destination)
                    ? Path.Combine(destination, Path.GetFileName(source))
                    : destination;
                Directory.Move(source, dest);
                return $$"""{"path":"{{Esc(dest)}}","status":"moved"}""";
            }
            return """{"error":"Source path not found"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string Copy(string source, string destination)
    {
        try
        {
            if (File.Exists(source))
            {
                var dest = Directory.Exists(destination)
                    ? Path.Combine(destination, Path.GetFileName(source))
                    : destination;
                File.Copy(source, dest, true);
                return $$"""{"path":"{{Esc(dest)}}","status":"copied"}""";
            }
            if (Directory.Exists(source))
            {
                var dest = Directory.Exists(destination)
                    ? Path.Combine(destination, Path.GetFileName(source))
                    : destination;
                CopyDirectory(source, dest);
                return $$"""{"path":"{{Esc(dest)}}","status":"copied"}""";
            }
            return """{"error":"Source path not found"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string Compress(string path)
    {
        try
        {
            var zipPath = path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + ".zip";
            if (File.Exists(zipPath)) File.Delete(zipPath);

            if (Directory.Exists(path))
            {
                ZipFile.CreateFromDirectory(path, zipPath);
            }
            else if (File.Exists(path))
            {
                using var zip = ZipFile.Open(zipPath, ZipArchiveMode.Create);
                zip.CreateEntryFromFile(path, Path.GetFileName(path));
            }
            else
            {
                return """{"error":"Path not found"}""";
            }
            var size = new FileInfo(zipPath).Length;
            return $$"""{"path":"{{Esc(zipPath)}}","size":{{size}},"status":"compressed"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string Decompress(string zipPath, string? destination = null)
    {
        try
        {
            if (!File.Exists(zipPath)) return """{"error":"Archive not found"}""";
            var dest = destination ?? Path.Combine(
                Path.GetDirectoryName(zipPath) ?? "",
                Path.GetFileNameWithoutExtension(zipPath));
            ZipFile.ExtractToDirectory(zipPath, dest, true);
            return $$"""{"path":"{{Esc(dest)}}","status":"decompressed"}""";
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    public static string CreateShortcut(string targetPath)
    {
        try
        {
            if (!File.Exists(targetPath) && !Directory.Exists(targetPath))
                return """{"error":"Target path not found"}""";

            if (OperatingSystem.IsWindows())
            {
                var lnkPath = targetPath + ".lnk";
                var script = $"$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('{lnkPath.Replace("'", "''")}'); $s.TargetPath = '{targetPath.Replace("'", "''")}'; $s.Save()";
                var psi = new System.Diagnostics.ProcessStartInfo("powershell", $"-NoProfile -Command \"{script}\"")
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                };
                using var proc = System.Diagnostics.Process.Start(psi)!;
                proc.WaitForExit(10000);
                return $$"""{"path":"{{Esc(lnkPath)}}","status":"shortcut_created"}""";
            }
            else
            {
                var linkPath = targetPath + ".link";
                File.CreateSymbolicLink(linkPath, targetPath);
                return $$"""{"path":"{{Esc(linkPath)}}","status":"shortcut_created"}""";
            }
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.GetFiles(source))
            File.Copy(file, Path.Combine(destination, Path.GetFileName(file)), true);
        foreach (var dir in Directory.GetDirectories(source))
            CopyDirectory(dir, Path.Combine(destination, Path.GetFileName(dir)));
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
