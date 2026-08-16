using System.Text.RegularExpressions;

namespace LibraNextgen.Service.Services;

/// <summary>
/// Rewrites HTML/CSS responses so every URL routes back through the proxy endpoint.
/// Absolute URLs are rewritten to proxy paths; relative URLs resolve via the injected <base>.
/// </summary>
public static partial class ProxyRewriter
{
    public static string RewriteHtml(string html, string finalUrl, string agentId, string token)
    {
        var baseUri = new Uri(finalUrl);
        var proxyBase = ToProxyPath(finalUrl, agentId, token);

        // Drop existing <base> and meta refresh (we own them).
        html = BaseTagRegex().Replace(html, string.Empty);
        html = MetaRefreshRegex().Replace(html, string.Empty);

        // Inject <base> so relative (and JS-generated relative) URLs resolve through the proxy,
        // plus a tiny interceptor that rewrites root-relative/absolute URLs produced by JS at runtime.
        var baseTag = $"<base href=\"{proxyBase}\">";
        var headInjection = baseTag + BuildInterceptorScript(agentId, token, finalUrl);
        if (HeadRegex().IsMatch(html))
            html = HeadRegex().Replace(html, m => m.Value + headInjection, 1);
        else
            html = headInjection + html;

        html = RewriteAttrs(html, baseUri, agentId, token);
        html = RewriteCssUrls(html, baseUri, agentId, token);
        return html;
    }

    /// <summary>
    /// Injects a small script that rewrites root-relative ("/x") and absolute ("http(s)://", "//")
    /// URLs generated at runtime (fetch/XHR/src/href) back through the proxy. Relative URLs are
    /// left untouched so the injected &lt;base&gt; resolves them.
    /// </summary>
    private static string BuildInterceptorScript(string agentId, string token, string finalUrl)
    {
        var uri = new Uri(finalUrl);
        var scheme = uri.Scheme;
        var host = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
        var prefix = $"/api/proxy/{agentId}/{token}/p/";

        var js = @"(function(){
  var P=__P__,S=__S__,H=__H__;
  function rw(u){
    if(typeof u!=='string'||!u)return u;
    if(/^(data|blob|javascript|mailto|tel|about):/i.test(u))return u;
    var a;
    try{
      if(/^https?:\/\//i.test(u)){a=new URL(u);}
      else if(/^\/\//.test(u)){a=new URL(S+'://'+H+u.slice(1));}
      else if(u.charAt(0)==='/'){a=new URL(S+'://'+H+u);}
      else{return u;}
    }catch(e){return u;}
    var h=a.port?a.hostname+':'+a.port:a.hostname;
    return P+a.protocol.slice(0,-1)+'/'+h+a.pathname+a.search;
  }
  function patch(proto,prop){
    try{
      var d=Object.getOwnPropertyDescriptor(proto,prop);
      if(d&&d.set){
        var s=d.set;
        Object.defineProperty(proto,prop,{set:function(v){s.call(this,rw(v));},get:d.get,configurable:true});
      }
    }catch(e){}
  }
  ['HTMLImageElement','HTMLScriptElement','HTMLLinkElement','HTMLIFrameElement','HTMLSourceElement','HTMLMediaElement','HTMLEmbedElement','HTMLInputElement','HTMLTrackElement'].forEach(function(n){
    var c=window[n];if(c){patch(c.prototype,'src');patch(c.prototype,'href');}
  });
  try{var f=window.fetch;window.fetch=function(u,o){if(typeof u==='string')u=rw(u);return f.call(this,u,o);};}catch(e){}
  try{var xo=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){return xo.call(this,m,rw(u));};}catch(e){}
  try{var WS=window.WebSocket;window.WebSocket=function(u,p){return new WS(rw(u),p);};}catch(e){}
})();";

        return "<script>" + js
            .Replace("__P__", System.Text.Json.JsonSerializer.Serialize(prefix))
            .Replace("__S__", System.Text.Json.JsonSerializer.Serialize(scheme))
            .Replace("__H__", System.Text.Json.JsonSerializer.Serialize(host)) + "</script>";
    }

    public static string RewriteCss(string css, string finalUrl, string agentId, string token)
    {
        return RewriteCssUrls(css, new Uri(finalUrl), agentId, token);
    }

    private static string RewriteAttrs(string html, Uri baseUri, string agentId, string token)
    {
        html = AttrRegex().Replace(html, m =>
        {
            var attr = m.Groups[1].Value.ToLowerInvariant();
            var raw = m.Groups[3].Value;
            var resolved = ResolveUrl(raw, baseUri);
            return resolved == null ? m.Value : $"{attr}=\"{ToProxyPath(resolved, agentId, token)}\"";
        });

        html = SrcsetRegex().Replace(html, m =>
        {
            var raw = m.Groups[2].Value;
            return $"srcset=\"{RewriteSrcset(raw, baseUri, agentId, token)}\"";
        });

        return html;
    }

    private static string RewriteSrcset(string srcset, Uri baseUri, string agentId, string token)
    {
        return SrcsetItemRegex().Replace(srcset, m =>
        {
            var url = m.Groups[1].Value;
            var resolved = ResolveUrl(url, baseUri);
            return resolved == null ? m.Value : ToProxyPath(resolved, agentId, token) + m.Groups[2].Value;
        });
    }

    private static string RewriteCssUrls(string text, Uri baseUri, string agentId, string token)
    {
        return CssUrlRegex().Replace(text, m =>
        {
            var raw = m.Groups[2].Value;
            var resolved = ResolveUrl(raw, baseUri);
            return resolved == null ? m.Value : $"url(\"{ToProxyPath(resolved, agentId, token)}\")";
        });
    }

    private static string? ResolveUrl(string raw, Uri baseUri)
    {
        var trimmed = raw.Trim();
        if (trimmed.Length == 0) return null;
        if (trimmed.StartsWith("#")) return null;
        if (trimmed.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("blob:", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("javascript:", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("mailto:", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("tel:", StringComparison.OrdinalIgnoreCase)
            || trimmed.StartsWith("about:", StringComparison.OrdinalIgnoreCase))
            return null;

        return Uri.TryCreate(baseUri, trimmed, out var resolved) ? resolved.AbsoluteUri : null;
    }

    public static string ToProxyPath(string absoluteUrl, string agentId, string token)
    {
        var uri = new Uri(absoluteUrl);
        var host = uri.IsDefaultPort ? uri.Host : $"{uri.Host}:{uri.Port}";
        var path = uri.AbsolutePath.TrimStart('/');
        var result = $"/api/proxy/{agentId}/{token}/p/{uri.Scheme}/{host}";
        if (!string.IsNullOrEmpty(path)) result += "/" + path;
        if (!string.IsNullOrEmpty(uri.Query)) result += uri.Query;
        return result;
    }

    [GeneratedRegex(@"<base\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex BaseTagRegex();

    [GeneratedRegex(@"<meta\b[^>]*http-equiv\s*=\s*[""']refresh[""'][^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex MetaRefreshRegex();

    [GeneratedRegex(@"<head\b[^>]*>", RegexOptions.IgnoreCase)]
    private static partial Regex HeadRegex();

    [GeneratedRegex(@"\b(src|href|action|poster)\s*=\s*(['""])(.*?)\2", RegexOptions.IgnoreCase)]
    private static partial Regex AttrRegex();

    [GeneratedRegex(@"\bsrcset\s*=\s*(['""])(.*?)\1", RegexOptions.IgnoreCase)]
    private static partial Regex SrcsetRegex();

    [GeneratedRegex(@"(\S+)(\s+\d+[wx])?", RegexOptions.IgnoreCase)]
    private static partial Regex SrcsetItemRegex();

    [GeneratedRegex(@"url\(\s*(['""]?)(.*?)\1\s*\)", RegexOptions.IgnoreCase)]
    private static partial Regex CssUrlRegex();
}
