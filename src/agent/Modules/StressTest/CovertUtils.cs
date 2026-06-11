using System.Security.Cryptography;

namespace LibraNextgen.Agent.Modules.StressTest;

public static class CovertUtils
{
    private static readonly string[] UserAgents =
    [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 Safari/605.1.15",
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15",
        "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36"
    ];

    private static readonly string[] Referers =
    [
        "https://www.google.com/",
        "https://www.bing.com/",
        "https://duckduckgo.com/",
        "https://www.baidu.com/",
        "https://github.com/",
        "https://stackoverflow.com/",
        null! // no referer
    ];

    private static readonly string[] AcceptLanguages =
    [
        "en-US,en;q=0.9", "zh-CN,zh;q=0.9,en;q=0.8",
        "ja-JP,ja;q=0.9,en;q=0.8", "ko-KR,ko;q=0.9,en;q=0.8",
        "de-DE,de;q=0.9,en;q=0.8", "fr-FR,fr;q=0.9,en;q=0.8"
    ];

    private static readonly Random _rng = new();

    public static string RandomUserAgent()
    {
        return UserAgents[RandomNumberGenerator.GetInt32(UserAgents.Length)];
    }

    public static string? RandomReferer()
    {
        var r = Referers[RandomNumberGenerator.GetInt32(Referers.Length)];
        return r;
    }

    public static string RandomAcceptLanguage()
    {
        return AcceptLanguages[RandomNumberGenerator.GetInt32(AcceptLanguages.Length)];
    }

    public static int RandomJitter(int baseMs, double jitterPct = 0.3)
    {
        var range = (int)(baseMs * jitterPct);
        return baseMs - range + RandomNumberGenerator.GetInt32(range * 2);
    }

    public static byte[] RandomPayload(int minSize, int maxSize)
    {
        var size = minSize + RandomNumberGenerator.GetInt32(maxSize - minSize + 1);
        var buf = new byte[size];
        RandomNumberGenerator.Fill(buf);
        return buf;
    }

    public static int RandomSourcePort()
    {
        return 1025 + RandomNumberGenerator.GetInt32(64510);
    }

    public static ushort RandomTcpWindow()
    {
        // Random window sizes between 1024 and 65535
        return (ushort)(1024 + RandomNumberGenerator.GetInt32(64511));
    }
}
