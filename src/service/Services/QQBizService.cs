using System.Net;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace LibraNextgen.Service.Services;

/// <summary>
/// 服务端实现的 QQ 业务工具（移植自 qqkeytool.go）。
/// 流程：使用 uin + clientkey 访问 ptlogin2 jump 换取 QQ 业务 cookie（skey/p_skey），
/// 再由 skey 计算 bkn/g_tk 调用 QQ 业务 API。全部在服务端发起（规避浏览器 CORS，
/// 且 Cookie 会话由服务端维护），前端只提交参数并展示返回。
/// </summary>
public class QQBizService
{
    private const string UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36";
    private const string UA_MOBILE = "Mozilla/5.0 (Linux; Android 16; DNN-AN00 Build/HONORDNN-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.179 Mobile Safari/537.36 V1_AND_SQ_9.3.30_15390_YYB_D QQ/9.3.30.39375 NetType/WIFI WebP/0.4.1 AppId/537378243";
    private const string UA_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";

    private static readonly string[] CookieDomains =
    {
        "ptlogin2.qq.com", "qq.com", "qzone.qq.com", "user.qzone.qq.com", "h5.qzone.qq.com",
        "qun.qq.com", "web.qun.qq.com", "pan.qun.qq.com", "ti.qq.com", "accounts.qq.com", "zb.vip.qq.com",
    };

    public class QQBizRequest
    {
        public string? Uin { get; set; }
        public string? Clientkey { get; set; }
        public string? Text { get; set; }
        public string? Nickname { get; set; }
        public string? Company { get; set; }
        public string? Qunn { get; set; }
        public string? BusId { get; set; }
        public string? FileId { get; set; }
        public string? TargetUin { get; set; }
        public int CareAction { get; set; } = 1;
        [JsonPropertyName("geqian")]
        public bool Geqian { get; set; }
    }

    /// <summary>执行一个 QQ 业务动作，返回原始响应文本。</summary>
    public async Task<string> RunAsync(string action, QQBizRequest req, CancellationToken ct)
    {
        var uin = req.Uin ?? throw new ArgumentException("uin is required");
        var key = req.Clientkey ?? throw new ArgumentException("clientkey is required");

        return action switch
        {
            "shuoshuo" => await ShuoshuoAsync(uin, key, req.Text ?? "", req.Geqian, ct),
            "profile" => await ProfileAsync(uin, key, req.Nickname ?? "", req.Company ?? "", ct),
            "friends" => await FriendsAsync(uin, key, ct),
            "groups" => await GroupsAsync(uin, key, ct),
            "group_notice" => await GroupNoticeAsync(uin, key, req.Qunn ?? "", ct),
            "group_files" => await GroupFilesAsync(uin, key, req.Qunn ?? "", ct),
            "delete_file" => await DeleteFileAsync(uin, key, req.Qunn ?? "", req.BusId ?? "", req.FileId ?? "", ct),
            "friendship" => await FriendshipAsync(uin, key, req.TargetUin ?? "", ct),
            "care" => await CareAsync(uin, key, req.TargetUin ?? "", req.CareAction, ct),
            "phone" => await PhoneAsync(uin, key, ct),
            _ => throw new ArgumentException($"unknown action '{action}'"),
        };
    }

    // ── session helper ────────────────────────────────────────────────

    private sealed class Session : IDisposable
    {
        public CookieContainer Jar { get; } = new();
        public HttpClientHandler Handler { get; }
        public HttpClient Client { get; }
        public string Skey { get; set; } = "";
        public string Pskey { get; set; } = "";
        public Session()
        {
            Handler = new HttpClientHandler
            {
                UseCookies = true,
                CookieContainer = Jar,
                AllowAutoRedirect = true,
                AutomaticDecompression = DecompressionMethods.GZip | DecompressionMethods.Deflate,
            };
            Client = new HttpClient(Handler) { Timeout = TimeSpan.FromSeconds(20) };
        }
        public void Dispose() { Handler.Dispose(); Client.Dispose(); }
    }

    private static long GetBkn(string skey)
    {
        long h = 5381;
        foreach (var c in skey) h += (h << 5) + c;
        return h & 0x7fffffff;
    }

    private static int GetGtk(string skey)
    {
        int h = 5381;
        foreach (var c in skey) h += (h << 5) + c;
        return h & 0x7fffffff;
    }

    private static string CookieHeader(CookieContainer jar, string host)
    {
        var sb = new StringBuilder();
        foreach (Cookie c in jar.GetCookies(new Uri("https://" + host)))
            sb.Append($"{c.Name}={c.Value}; ");
        return sb.ToString();
    }

    private static Dictionary<string, string> AllCookies(CookieContainer jar)
    {
        var map = new Dictionary<string, string>();
        foreach (var d in CookieDomains)
            foreach (Cookie c in jar.GetCookies(new Uri("https://" + d)))
                map[c.Name] = c.Value;
        return map;
    }

    /// <summary>jump 换 cookie；返回已带 jar/skey/pskey 的会话（业务域 cookie 用 <paramref name="host"/> 拼 Cookie 头）。</summary>
    private async Task<Session> JumpAsync(string uin, string key, string u1, string host, CancellationToken ct,
                                          string ua = UA)
    {
        var s = new Session();
        try
        {
            s.Client.DefaultRequestHeaders.UserAgent.ParseAdd(ua);
            var jump = $"https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin={uin}&clientkey={key}&u1={Uri.EscapeDataString(u1)}&source=panelstar&keyindex=19";
            using var resp = await s.Client.GetAsync(jump, ct);
            if (resp.StatusCode != HttpStatusCode.OK)
                throw new Exception($"jump failed HTTP {(int)resp.StatusCode}");

            var cookies = AllCookies(s.Jar);
            s.Skey = cookies.GetValueOrDefault("skey", "");
            s.Pskey = cookies.GetValueOrDefault("p_skey", "");
            if (s.Skey == "")
                s.Skey = cookies.GetValueOrDefault("p_skey", ""); // 部分域的 skey 缺失时退化
            return s;
        }
        catch
        {
            s.Dispose();
            throw;
        }
    }

    private static async Task<string> SendAsync(Session s, HttpMethod method, string url, string? body,
                                                string contentType, string host, string referer, string ua,
                                                CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, url);
        req.Headers.TryAddWithoutValidation("Cookie", CookieHeader(s.Jar, host));
        if (referer != "") req.Headers.TryAddWithoutValidation("Referer", referer);
        req.Headers.UserAgent.ParseAdd(ua);
        if (body != null)
        {
            req.Content = new StringContent(body, Encoding.UTF8);
            req.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(contentType);
        }
        using var resp = await s.Client.SendAsync(req, ct);
        return await resp.Content.ReadAsStringAsync(ct);
    }

    // ── 业务动作 ─────────────────────────────────────────────────────

    // 1. 发说说
    private async Task<string> ShuoshuoAsync(string uin, string key, string text, bool geqian, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, $"https://user.qzone.qq.com/{uin}/infocenter", "user.qzone.qq.com", ct);
        var form = new Dictionary<string, string>
        {
            ["qzreferrer"] = $"https://user.qzone.qq.com/{uin}/infocenter",
            ["syn_tweet_verson"] = "1", ["paramstr"] = "1", ["pic_template"] = "", ["richtype"] = "",
            ["richval"] = "", ["special_url"] = "", ["subrichtype"] = "", ["con"] = "qm" + text,
            ["feedversion"] = "1", ["ver"] = "1", ["ugc_right"] = "1", ["to_sign"] = geqian ? "1" : "0",
            ["hostuin"] = uin, ["code_version"] = "1", ["format"] = "fs",
        };
        var body = new FormUrlEncodedContent(form).ReadAsStringAsync(ct).GetAwaiter().GetResult();
        var url = $"https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?&g_tk={GetGtk(s.Pskey == "" ? s.Skey : s.Pskey)}";
        return await SendAsync(s, HttpMethod.Post, url, body, "application/x-www-form-urlencoded", "user.qzone.qq.com", $"https://user.qzone.qq.com/{uin}/infocenter", UA_FIREFOX, ct);
    }

    // 2. 修改空间资料
    private async Task<string> ProfileAsync(string uin, string key, string nickname, string company, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, $"https://user.qzone.qq.com/{uin}/infocenter", "user.qzone.qq.com", ct);
        var form = new Dictionary<string, string>
        {
            ["qzreferrer"] = "https://user.qzone.qq.com/proxy/domain/qzonestyle.gtimg.cn/qzone/v6/setting/profile/profile.html?tab=base&g_iframeUser=1",
            ["nickname"] = nickname, ["emoji"] = "", ["sex"] = "1", ["birthday"] = "1984-01-01",
            ["province"] = "", ["city"] = "", ["country"] = "", ["marriage"] = "0", ["bloodtype"] = "5",
            ["hp"] = "0", ["hc"] = "0", ["hco"] = "0", ["career"] = "", ["company"] = company,
            ["cp"] = "0", ["cc"] = "0", ["cb"] = "", ["cco"] = "0", ["lover"] = "", ["islunar"] = "0",
            ["mb"] = "1", ["uin"] = uin, ["pageindex"] = "1", ["nofeeds"] = "1", ["fupdate"] = "1",
        };
        var body = new FormUrlEncodedContent(form).ReadAsStringAsync(ct).GetAwaiter().GetResult();
        var url = $"https://h5.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/user/cgi_apply_updateuserinfo_new?&g_tk={GetGtk(s.Pskey == "" ? s.Skey : s.Pskey)}";
        return await SendAsync(s, HttpMethod.Post, url, body, "application/x-www-form-urlencoded", "h5.qzone.qq.com", "https://user.qzone.qq.com/", UA_FIREFOX, ct);
    }

    // 3. 好友列表
    private async Task<string> FriendsAsync(string uin, string key, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, $"https://user.qzone.qq.com/{uin}/infocenter", "user.qzone.qq.com", ct);
        var rd = $"0.{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        var url = $"https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/friend_ship_manager.cgi?uin={uin}&do=1&rd={rd}&fupdate=1&clean=1&g_tk={GetGtk(s.Skey)}";
        return await SendAsync(s, HttpMethod.Get, url, null, "", "user.qzone.qq.com", "https://user.qzone.qq.com/", UA, ct);
    }

    // 4. 群组列表
    private async Task<string> GroupsAsync(string uin, string key, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, "https://qun.qq.com", "qun.qq.com", ct);
        var url = $"http://qun.qq.com/cgi-bin/qun_mgr/get_group_list?bkn={GetBkn(s.Skey)}";
        return await SendAsync(s, HttpMethod.Get, url, null, "", "qun.qq.com", "", UA, ct);
    }

    // 5. 群公告
    private async Task<string> GroupNoticeAsync(string uin, string key, string qunn, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, "https://qun.qq.com", "web.qun.qq.com", ct);
        var body = $"bkn={GetBkn(s.Skey)}&qid={qunn}&ft=23&s=-1&n=10&ni=1&i=1";
        return await SendAsync(s, HttpMethod.Post, "https://web.qun.qq.com/cgi-bin/announce/get_t_list", body, "application/x-www-form-urlencoded", "web.qun.qq.com", "", UA_FIREFOX, ct);
    }

    // 6. 群文件列表
    private async Task<string> GroupFilesAsync(string uin, string key, string qunn, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, "https://qun.qq.com", "pan.qun.qq.com", ct);
        var body = $"gc={qunn}&bkn={GetBkn(s.Skey)}&start_index=0&cnt=50&filter_code=0&folder_id=/&show_onlinedoc_folder=1";
        return await SendAsync(s, HttpMethod.Post, "https://pan.qun.qq.com/cgi-bin/group_file/get_file_list", body, "application/x-www-form-urlencoded", "pan.qun.qq.com", "", UA_FIREFOX, ct);
    }

    // 7. 删除群文件
    private async Task<string> DeleteFileAsync(string uin, string key, string qunn, string busId, string fileId, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, "https://qun.qq.com", "pan.qun.qq.com", ct);
        var list = JsonSerializer.Serialize(new { file_list = new[] { new { gc = long.Parse(qunn), app_id = 4, bus_id = long.Parse(busId), file_id = fileId, parent_folder_id = "/" } } });
        var body = $"src=qpan&gc={qunn}&bkn={GetBkn(s.Skey)}&bus_id={busId}&file_id={fileId}&app_id=4&parent_folder_id=/&file_list={Uri.EscapeDataString(list)}";
        return await SendAsync(s, HttpMethod.Post, "http://pan.qun.qq.com/cgi-bin/group_file/delete_file", body, "application/x-www-form-urlencoded", "pan.qun.qq.com", "", UA, ct);
    }

    // 8. 好友亲密度
    private async Task<string> FriendshipAsync(string uin, string key, string target, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, "https://h5.qzone.qq.com", "h5.qzone.qq.com", ct);
        var url = $"https://h5.qzone.qq.com/close/friendship/{target}?_wv=16777219&source=myfriend";
        return await SendAsync(s, HttpMethod.Get, url, null, "", "h5.qzone.qq.com", "https://h5.qzone.qq.com/platform/myfriend?_wv=3&_proxy=1", UA_MOBILE, ct);
    }

    // 9. 设置/移除特别关心
    private async Task<string> CareAsync(string uin, string key, string target, int action, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, "https://h5.qzone.qq.com", "h5.qzone.qq.com", ct);
        var json = JsonSerializer.Serialize(new
        {
            action,
            special = new { allnum = 1, datalist = new[] { new { uin = long.Parse(target) } } },
        });
        var url = $"https://h5.qzone.qq.com/webapp/json/vpageCover_v2/setCareList?t=0.{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}&g_tk={GetGtk(s.Pskey == "" ? s.Skey : s.Pskey)}";
        return await SendAsync(s, HttpMethod.Post, url, json, "application/json", "h5.qzone.qq.com", "https://h5.qzone.qq.com/platform/myfriend?_wv=3&_proxy=1", UA_MOBILE, ct);
    }

    // 10. 获取绑定手机号
    private async Task<string> PhoneAsync(string uin, string key, CancellationToken ct)
    {
        using var s = await JumpAsync(uin, key, "https://accounts.qq.com", "accounts.qq.com", ct, UA_MOBILE);
        var body = await SendAsync(s, HttpMethod.Get, "https://accounts.qq.com/kaiyang/sms?_wv=3&appid=101945038", null, "", "accounts.qq.com", "", UA_MOBILE, ct);
        var start = body.IndexOf("window.__INITIAL_STATE__=", StringComparison.Ordinal);
        if (start < 0) return body;
        var cut = body[(start + "window.__INITIAL_STATE__=".Length)..];
        var end = cut.IndexOf("</script>", StringComparison.Ordinal);
        var json = end >= 0 ? cut[..end] : cut;
        return json;
    }
}