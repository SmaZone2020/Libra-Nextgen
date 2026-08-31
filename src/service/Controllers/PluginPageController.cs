using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

/// <summary>
/// Runtime page assets for plugin frontends.
///
/// A plugin may ship its console page in one of two forms (both live under
/// <c>PluginsBaseDir/&lt;pluginId&gt;/page/</c>):
/// <list type="bullet">
///   <item><b>react</b> — a pre-compiled bundle at <c>page/dist/index.js</c>
///   (IIFE, React/HeroUI externalized onto <c>window.LibraPluginHost</c>).
///   The console injects it via a &lt;script&gt; tag and renders its default
///   export in-host.</item>
///   <item><b>html</b> — a plain <c>page/index.html</c> plus its own js/css.
///   The console loads it in an iframe; the plugin talks to the console
///   through the postMessage bridge served at <c>page/_bridge.js</c>.</item>
/// </list>
///
/// <c>manifest.json</c> tells the console which form a plugin ships, so the
/// console can stay completely generic. Anonymous like <c>assets/</c>: the page
/// payload carries no sensitive data — all data flows through authenticated
/// APIs, and both &lt;script&gt;/iframe loading would otherwise need a token
/// header the browser cannot attach.
/// </summary>
[ApiController]
[Route("api/plugins/{pluginId}/page")]
[AllowAnonymous]
public class PluginPageController : ControllerBase
{
    private readonly PluginService _plugins;

    public PluginPageController(PluginService plugins)
    {
        _plugins = plugins;
    }

    /// <summary>Extensions the page endpoint will serve (whitelist).</summary>
    private static readonly HashSet<string> AllowedExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".js", ".mjs", ".css", ".html", ".htm", ".json", ".map",
        ".svg", ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2", ".ttf", ".otf",
    };

    private static string ContentTypeFor(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".html" or ".htm" => "text/html; charset=utf-8",
        ".json" or ".map" => "application/json; charset=utf-8",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".gif" => "image/gif",
        ".ico" => "image/x-icon",
        ".webp" => "image/webp",
        ".woff" => "font/woff",
        ".woff2" => "font/woff2",
        ".ttf" => "font/ttf",
        ".otf" => "font/otf",
        _ => "application/octet-stream",
    };

    private static bool IsSafeFilename(string filename) =>
        !string.IsNullOrWhiteSpace(filename)
        && !filename.Contains("..")
        && filename.Length <= 512
        && filename.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_' or '/');

    /// <summary>
    /// Describe the plugin's page. Every plugin page ships as plain
    /// <c>page/index.html</c> + js/css — there is no TSX path anymore. The
    /// console renders it in an iframe and the plugin talks to the console
    /// through the bridge SDK (<c>page/_bridge.js</c>).
    /// </summary>
    [HttpGet("manifest.json")]
    public async Task<IActionResult> Manifest(string pluginId, CancellationToken ct)
    {
        if (pluginId.Any(c => !(char.IsAsciiLetterOrDigit(c) || c is '.' or '-' or '_')))
            return BadRequest(new { error = "invalid plugin id" });

        var pageDir = Path.Combine(PluginService.PluginsBaseDir, pluginId, "page");
        var htmlFile = Path.Combine(pageDir, "index.html");
        if (!System.IO.File.Exists(htmlFile))
            return NotFound(new { error = "plugin page not found (expected page/index.html)" });

        // Version for cache-busting: prefer the persisted record, fall back to
        // the newest file timestamp (handles plugins installed without a DB row).
        var version = "";
        try
        {
            var record = await _plugins.GetByPluginIdAsync(pluginId, ct);
            version = record?.Version ?? "";
        }
        catch
        {
            // DB unavailable — timestamp fallback below.
        }

        var newest = Directory.Exists(pageDir)
            ? Directory.EnumerateFiles(pageDir, "*", SearchOption.AllDirectories)
                .Select(System.IO.File.GetLastWriteTimeUtc)
                .DefaultIfEmpty(DateTime.MinValue)
                .Max()
            : DateTime.MinValue;
        if (string.IsNullOrEmpty(version))
            version = newest.ToFileTimeUtc().ToString();

        return Ok(new
        {
            pluginId,
            kind = "html",
            entry = "index.html",
            version,
            generatedAt = newest.ToString("o"),
        });
    }

    /// <summary>Serve a plugin page asset (js/css/html/img/font), including
    /// the pre-compiled <c>dist/index.js</c> bundle and nested subdirectories.</summary>
    [HttpGet("{**file}")]
    public IActionResult GetFile(string pluginId, string file)
    {
        if (!IsSafeFilename(file))
            return BadRequest(new { error = "invalid filename" });
        if (!AllowedExtensions.Contains(Path.GetExtension(file)))
            return BadRequest(new { error = "file type not allowed" });

        var path = Path.Combine(PluginService.PluginsBaseDir, pluginId, "page", file);
        if (!System.IO.File.Exists(path))
            return NotFound();

        var etag = $"\"{System.IO.File.GetLastWriteTimeUtc(path).ToFileTimeUtc():x}\"";
        if (Request.Headers.IfNoneMatch.ToString() == etag)
            return StatusCode(304);

        Response.Headers.ETag = etag;
        // Short cache: entry bundles are versioned via manifest, sub-assets may
        // change during plugin development — 5 minutes is a safe compromise.
        Response.Headers.CacheControl = "public, max-age=300";
        return PhysicalFile(path, ContentTypeFor(path));
    }

    /// <summary>
    /// Bridge SDK injected into HTML-form plugin pages. The plugin includes
    /// <c>&lt;script src="_bridge.js"&gt;&lt;/script&gt;</c> and then calls the
    /// same <c>window.LibraPluginHost.usePluginHost()</c> API as React pages,
    /// proxied to the console frame via postMessage.
    /// </summary>
    [HttpGet("_bridge.js")]
    public IActionResult Bridge()
    {
        Response.Headers.CacheControl = "no-store";
        return Content(BridgeScript, "text/javascript; charset=utf-8", Encoding.UTF8);
    }

    private const string BridgeScript = """
        // Libra plugin bridge — runs inside an HTML-form plugin iframe.
        // Exposes window.LibraPluginHost to the page and proxies everything
        // to the console frame via postMessage RPC.
        (function () {
          'use strict';
          if (window.__libraBridgeLoaded) return;
          window.__libraBridgeLoaded = true;

          // pluginId is derived from the iframe URL: /api/plugins/<id>/page/...
          var m = /\/api\/plugins\/([^/]+)\/page\//.exec(location.pathname);
          var PLUGIN_ID = m ? decodeURIComponent(m[1]) : '';

          var pending = new Map();
          var nextId = 1;

          function send(msg) {
            window.parent.postMessage({ __libraRpc: true, __libraMsg: msg }, '*');
          }

          function request(op, params) {
            return new Promise(function (resolve, reject) {
              var id = nextId++;
              pending.set(id, { resolve: resolve, reject: reject });
              send({ id: id, op: op, params: params });
              // No hard timeout — long-running actions (e.g. dispatchTask) may
              // legitimately take minutes; the console always resolves.
            });
          }

          window.addEventListener('message', function (ev) {
            if (!ev.data || ev.data.__libraRpc !== true) return;
            var msg = ev.data.__libraMsg;
            if (!msg) return;
            if (msg.id && pending.has(msg.id)) {
              var p = pending.get(msg.id);
              pending.delete(msg.id);
              if (msg.ok) p.resolve(msg.result);
              else p.reject(new Error(msg.error || 'libra bridge call failed'));
            } else if (msg.event === 'output') {
              var subs = listeners.slice();
              for (var i = 0; i < subs.length; i++) subs[i](msg.data);
            }
          });

          var listeners = [];
          var host = {
            selectedAgent: null,
            lastOutput: null,
            selectAgent: function (id) { return request('call', { method: 'selectAgent', params: [id] }); },
            dispatchTask: function (pluginId, action, args, agentId) {
              return request('call', {
                method: 'dispatchTask',
                params: [pluginId || PLUGIN_ID, action, args || {}, agentId],
              });
            },
            subscribeOutput: function (cb, action) {
              listeners.push(cb);
              request('subscribe', { action: action || '' });
              return function () {
                var i = listeners.indexOf(cb);
                if (i >= 0) listeners.splice(i, 1);
              };
            },
          };

          // Authenticated backend API on behalf of the page. The plugin cannot
          // read the console's JWT (cross-origin localStorage), so the console
          // attaches its own Authorization header and forwards the response.
          function apiCall(method, path, body) {
            return request('api', { method: method, path: path, body: body === undefined ? null : body });
          }
          var api = {
            get: function (path) { return apiCall('GET', path); },
            post: function (path, body) { return apiCall('POST', path, body); },
            put: function (path, body) { return apiCall('PUT', path, body); },
            delete: function (path, body) { return apiCall('DELETE', path, body); },
          };

          function syncState() {
            request('getState', {}).then(function (state) {
              host.selectedAgent = state.selectedAgent || null;
              host.lastOutput = state.lastOutput || null;
            }).catch(function () {});
          }

          syncState();
          // Poll state every 2s so agent selection made in the console shows up
          // in the iframe without requiring a re-subscribe dance.
          setInterval(syncState, 2000);

          window.LibraPluginHost = Object.freeze({
            pluginId: PLUGIN_ID,
            getApiOrigin: function () { return location.origin; },
            usePluginHost: function () { return host; },
            api: api,
          });
        })();
        """;
}
