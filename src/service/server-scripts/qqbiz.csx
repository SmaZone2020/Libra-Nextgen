// qqbiz.csx — QQ 业务服务端脚本（.NET 自带 C# Scripting 解析执行）
// 调用：POST /api/plugin/qqbiz/函数  body: {"uin":"…","clientkey":"…", ...}（p 为 dynamic）
// 依赖注入说明：本脚本使用 .NET 原生 HttpClient/CookieContainer，未引用专用宿主。

using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Collections.Generic;

// ── 工具 ────────────────────────────────────────────────────────────────
static long Bkn(string skey) { long h = 5381; foreach (var c in skey) h += (h << 5) + c; return h & 0x7fffffff; }
static int Gtk(string skey) { int h = 5381; foreach (var c in skey) h += (h << 5) + c; return h & 0x7fffffff; }

static string Jump(string uin, string key, string u1) =>
    "https://ssl.ptlogin2.qq.com/jump?ptlang=1033&clientuin=" + uin +
    "&clientkey=" + key + "&u1=" + Uri.EscapeDataString(u1) + "&source=panelstar&keyindex=19";

static readonly string[] Domains =
{
    "ptlogin2.qq.com", "qq.com", "qzone.qq.com", "user.qzone.qq.com", "h5.qzone.qq.com",
    "qun.qq.com", "web.qun.qq.com", "pan.qun.qq.com", "ti.qq.com", "accounts.qq.com", "zb.vip.qq.com",
};

static (HttpClient Client, CookieContainer Jar) NewClient()
{
    var jar = new CookieContainer();
    var handler = new HttpClientHandler { UseCookies = true, CookieContainer = jar, AllowAutoRedirect = true };
    var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(20) };
    client.DefaultRequestHeaders.UserAgent.ParseAdd("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36");
    return (client, jar);
}

static string CookieValue(CookieContainer jar, string name)
{
    foreach (var d in Domains)
        foreach (Cookie c in jar.GetCookies(new Uri("https://" + d)))
            if (c.Name == name) return c.Value;
    return "";
}

static string Send(HttpClient client, CookieContainer jar, HttpMethod method, string url, string? body, string? contentType, string ua)
{
    using var req = new HttpRequestMessage(method, url);
    req.Headers.UserAgent.ParseAdd(ua);
    req.Headers.TryAddWithoutValidation("Cookie", CookieHeader(jar));
    if (body != null)
    {
        req.Content = new StringContent(body, Encoding.UTF8);
        if (contentType != null) req.Content.Headers.ContentType = System.Net.Http.Headers.MediaTypeHeaderValue.Parse(contentType);
    }
    using var resp = client.Send(req);
    return resp.Content.ReadAsStringAsync().GetAwaiter().GetResult();
}

static string CookieHeader(CookieContainer jar)
{
    var sb = new StringBuilder();
    foreach (var d in Domains)
        foreach (Cookie c in jar.GetCookies(new Uri("https://" + d)))
            sb.Append(c.Name + "=" + c.Value + "; ");
    return sb.ToString();
}

static string CookieHeaderFor(CookieContainer jar, string host)
{
    var sb = new StringBuilder();
    foreach (Cookie c in jar.GetCookies(new Uri("https://" + host)))
        sb.Append(c.Name + "=" + c.Value + "; ");
    return sb.ToString();
}

const string UA_FF = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0";
const string UA_MOBILE = "Mozilla/5.0 (Linux; Android 16; DNN-AN00 Build/HONORDNN-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0.7204.179 Mobile Safari/537.36 V1_AND_SQ_9.3.30_15390_YYB_D QQ/9.3.30.39375";

static string Need(HttpClient client, CookieContainer jar, string uin, string key, string u1)
{
    if (string.IsNullOrEmpty(uin) || string.IsNullOrEmpty(key)) throw new Exception("uin / clientkey 必填");
    client.GetAsync(Jump(uin, key, u1)).GetAwaiter().GetResult();
    var skey = CookieValue(jar, "skey");
    return skey != "" ? skey : CookieValue(jar, "p_skey");
}

// ── 1. 发 QQ 空间说说 ────────────────────────────────────────────────
static string Shuoshuo(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://user.qzone.qq.com/" + p.uin + "/infocenter");
    var pskey = CookieValue(jar, "p_skey") != "" ? CookieValue(jar, "p_skey") : skey;
    var form = "qzreferrer=" + Uri.EscapeDataString("https://user.qzone.qq.com/" + p.uin + "/infocenter") +
        "&syn_tweet_verson=1&paramstr=1&pic_template=&richtype=&richval=&special_url=&subrichtype=&con=" +
        Uri.EscapeDataString("qm" + (string)p.text) +
        "&feedversion=1&ver=1&ugc_right=1&to_sign=0&hostuin=" + p.uin + "&code_version=1&format=fs";
    return Send(c, jar, HttpMethod.Post,
        "https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6?&g_tk=" + Gtk(pskey),
        form, "application/x-www-form-urlencoded", UA_FF);
}

// ── 2. 修改空间资料 ──────────────────────────────────────────────────
static string Profile(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://user.qzone.qq.com/" + p.uin + "/infocenter");
    var pskey = CookieValue(jar, "p_skey") != "" ? CookieValue(jar, "p_skey") : skey;
    var form = "qzreferrer=" + Uri.EscapeDataString("https://user.qzone.qq.com/proxy/domain/qzonestyle.gtimg.cn/qzone/v6/setting/profile/profile.html?tab=base&g_iframeUser=1") +
        "&nickname=" + Uri.EscapeDataString(p.nickname ?? "") + "&emoji=&sex=1&birthday=1984-01-01&province=&city=&country=&marriage=0&bloodtype=5&hp=0&hc=0&hco=0&career=" +
        "&company=" + Uri.EscapeDataString(p.company ?? "") + "&cp=0&cc=0&cb=&cco=0&lover=&islunar=0&mb=1&uin=" + p.uin +
        "&pageindex=1&nofeeds=1&fupdate=1";
    return Send(c, jar, HttpMethod.Post,
        "https://h5.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/user/cgi_apply_updateuserinfo_new?&g_tk=" + Gtk(pskey),
        form, "application/x-www-form-urlencoded", UA_FF);
}

// ── 3. 好友列表 ──────────────────────────────────────────────────────
static string Friends(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://user.qzone.qq.com/" + p.uin + "/infocenter");
    return Send(c, jar, HttpMethod.Get,
        "https://user.qzone.qq.com/proxy/domain/r.qzone.qq.com/cgi-bin/tfriend/friend_ship_manager.cgi?uin=" + p.uin +
        "&do=1&rd=0." + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "&fupdate=1&clean=1&g_tk=" + Gtk(skey),
        null, null, "Mozilla/5.0");
}

// ── 4. 群组列表 ──────────────────────────────────────────────────────
static string Groups(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://qun.qq.com");
    return Send(c, jar, HttpMethod.Get, "http://qun.qq.com/cgi-bin/qun_mgr/get_group_list?bkn=" + Bkn(skey), null, null, "Mozilla/5.0");
}

// ── 5. 群公告列表 ────────────────────────────────────────────────────
static string GroupNotice(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://qun.qq.com");
    return Send(c, jar, HttpMethod.Post, "https://web.qun.qq.com/cgi-bin/announce/get_t_list",
        "bkn=" + Bkn(skey) + "&qid=" + p.qunn + "&ft=23&s=-1&n=10&ni=1&i=1",
        "application/x-www-form-urlencoded", UA_FF);
}

// ── 6. 群文件列表 ────────────────────────────────────────────────────
static string GroupFiles(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://qun.qq.com");
    return Send(c, jar, HttpMethod.Post, "https://pan.qun.qq.com/cgi-bin/group_file/get_file_list",
        "gc=" + p.qunn + "&bkn=" + Bkn(skey) + "&start_index=0&cnt=50&filter_code=0&folder_id=/&show_onlinedoc_folder=1",
        "application/x-www-form-urlencoded", UA_FF);
}

// ── 7. 删除群文件 ────────────────────────────────────────────────────
static string DeleteFile(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://qun.qq.com");
    var list = JsonSerializer.Serialize(new { file_list = new[] { new { gc = long.Parse((string)p.qunn), app_id = 4, bus_id = long.Parse((string)p.busId), file_id = (string)p.fileId, parent_folder_id = "/" } } });
    return Send(c, jar, HttpMethod.Post, "http://pan.qun.qq.com/cgi-bin/group_file/delete_file",
        "src=qpan&gc=" + p.qunn + "&bkn=" + Bkn(skey) + "&bus_id=" + p.busId + "&file_id=" + p.fileId +
        "&app_id=4&parent_folder_id=/&file_list=" + Uri.EscapeDataString(list),
        "application/x-www-form-urlencoded", "Mozilla/5.0");
}

// ── 8. 查看好友亲密度 ────────────────────────────────────────────────
static string Friendship(dynamic p)
{
    var (c, jar) = NewClient();
    Need(c, jar, (string)p.uin, (string)p.clientkey, "https://h5.qzone.qq.com");
    return Send(c, jar, HttpMethod.Get, "https://h5.qzone.qq.com/close/friendship/" + p.targetUin + "?_wv=16777219&source=myfriend",
        null, null, UA_MOBILE);
}

// ── 9. 设置/移除特别关心 ─────────────────────────────────────────────
static string Care(dynamic p)
{
    var (c, jar) = NewClient();
    var skey = Need(c, jar, (string)p.uin, (string)p.clientkey, "https://h5.qzone.qq.com");
    var pskey = CookieValue(jar, "p_skey") != "" ? CookieValue(jar, "p_skey") : skey;
    var json = JsonSerializer.Serialize(new { action = (int)(p.careAction ?? 1), special = new { allnum = 1, datalist = new[] { new { uin = long.Parse((string)p.targetUin) } } } });
    return Send(c, jar, HttpMethod.Post,
        "https://h5.qzone.qq.com/webapp/json/vpageCover_v2/setCareList?t=0." + DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() + "&g_tk=" + Gtk(pskey),
        json, "application/json", UA_MOBILE);
}

// ── 10. 获取绑定手机号 ───────────────────────────────────────────────
static string Phone(dynamic p)
{
    var (c, jar) = NewClient();
    Need(c, jar, (string)p.uin, (string)p.clientkey, "https://accounts.qq.com");
    var body = Send(c, jar, HttpMethod.Get, "https://accounts.qq.com/kaiyang/sms?_wv=3&appid=101945038", null, null, UA_MOBILE);
    const string marker = "window.__INITIAL_STATE__=";
    var i = body.IndexOf(marker, StringComparison.Ordinal);
    if (i < 0) return body;
    var cut = body.Substring(i + marker.Length);
    var j = cut.IndexOf("</script>", StringComparison.Ordinal);
    return j >= 0 ? cut.Substring(0, j) : cut;
}

// ── 导出函数表 ───────────────────────────────────────────────────────
return new Dictionary<string, Func<object, object>>
{
    ["shuoshuo"] = p => Shuoshuo((dynamic)p),
    ["profile"] = p => Profile((dynamic)p),
    ["friends"] = p => Friends((dynamic)p),
    ["groups"] = p => Groups((dynamic)p),
    ["group_notice"] = p => GroupNotice((dynamic)p),
    ["group_files"] = p => GroupFiles((dynamic)p),
    ["delete_file"] = p => DeleteFile((dynamic)p),
    ["friendship"] = p => Friendship((dynamic)p),
    ["care"] = p => Care((dynamic)p),
    ["phone"] = p => Phone((dynamic)p),
};