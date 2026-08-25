using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Protocol;
using LibraNextgen.Service.Services;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/files")]
[Authorize]
public class FilesController : ControllerBase
{
    private readonly RelayService _relay;

    public FilesController(RelayService relay)
    {
        _relay = relay;
    }

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, string messageType, object? data, CancellationToken ct)
    {
        // 60s：零 WS 架构下首次操作要拉起 realtime 模块（下载 ~4.4MB）+
        // files 模块下载，30s 默认值不够。
        var response = await _relay.RelayAndWaitAsync(agentId, messageType, data, ct, TimeSpan.FromSeconds(60));
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return response.Data != null
            ? Content(response.Data.Value.GetRawText(), "application/json")
            : Ok(new { status = "ok" });
    }

    [HttpPost("{agentId}/list")]
    public async Task<IActionResult> ListDirectory(string agentId, [FromBody] ListRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.list", new { path = req.Path, offset = req.Offset, limit = req.Limit }, ct);
    }

    [HttpPost("{agentId}/drives")]
    public async Task<IActionResult> GetDrives(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.drives", null, ct);
    }

    [HttpPost("{agentId}/read")]
    public async Task<IActionResult> ReadFile(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.read", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/open")]
    public async Task<IActionResult> OpenFile(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.open", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/write")]
    public async Task<IActionResult> WriteFile(string agentId, [FromBody] WriteRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.write", new { path = req.Path, content = req.Content }, ct);
    }

    [HttpDelete("{agentId}")]
    public async Task<IActionResult> DeleteFile(string agentId, [FromBody] DeleteRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.delete", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/mkdir")]
    public async Task<IActionResult> CreateDirectory(string agentId, [FromBody] MkdirRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.mkdir", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/rename")]
    public async Task<IActionResult> Rename(string agentId, [FromBody] RenameRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.rename", new { path = req.Path, newName = req.NewName }, ct);
    }

    [HttpPost("{agentId}/move")]
    public async Task<IActionResult> Move(string agentId, [FromBody] MoveRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.move", new { source = req.Source, destination = req.Destination }, ct);
    }

    [HttpPost("{agentId}/copy")]
    public async Task<IActionResult> Copy(string agentId, [FromBody] CopyRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.copy", new { source = req.Source, destination = req.Destination }, ct);
    }

    [HttpPost("{agentId}/compress")]
    public async Task<IActionResult> Compress(string agentId, [FromBody] CompressRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.compress", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/decompress")]
    public async Task<IActionResult> Decompress(string agentId, [FromBody] DecompressRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.decompress", new { path = req.Path, destination = req.Destination }, ct);
    }

    [HttpPost("{agentId}/shortcut")]
    public async Task<IActionResult> CreateShortcut(string agentId, [FromBody] ShortcutRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.shortcut", new { path = req.Path }, ct);
    }

    [HttpPost("{agentId}/archive/list")]
    public async Task<IActionResult> ListArchive(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, "file.archive_list", new { path = req.Path }, ct);
    }

    // Streaming download: the file is fetched from the agent in chunks
    // (default 2 MB per relay round-trip) and written straight to the HTTP
    // response body — neither the server nor the agent ever holds the whole
    // file in memory, and each WS frame stays well under the 4 MB cap.
    private const int DownloadChunkSize = 2 * 1024 * 1024;
    private const int DownloadTimeoutSeconds = 30;

    [HttpPost("{agentId}/download")]
    public async Task<IActionResult> Download(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        var fileName = System.IO.Path.GetFileName(req.Path);
        var agentPath = req.Path;

        // First chunk doubles as a probe: errors surface as a normal 4xx.
        var first = await _relay.RelayAndWaitAsync(
            agentId, "file.download",
            new { path = agentPath, offset = 0L, chunkSize = DownloadChunkSize },
            ct, TimeSpan.FromSeconds(DownloadTimeoutSeconds));
        if (first == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });

        var firstJson = first.Data != null ? first.Data.Value.GetRawText() : null;
        if (firstJson == null)
            return StatusCode(502, new { error = "Empty agent response." });

        using var firstDoc = JsonDocument.Parse(firstJson);
        if (firstDoc.RootElement.TryGetProperty("error", out var errProp))
            return BadRequest(new { error = errProp.GetString() ?? "unknown error" });

        var offset = firstDoc.RootElement.GetProperty("offset").GetInt64();
        var done = firstDoc.RootElement.TryGetProperty("done", out var doneProp) && doneProp.GetBoolean();

        // Stream started — set headers then write chunk-by-chunk.
        Response.StatusCode = 200;
        Response.ContentType = "application/octet-stream";
        Response.Headers.ContentDisposition =
            $"attachment; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";

        offset += await WriteChunkAsync(firstDoc, Response.Body, ct);

        while (!done)
        {
            var next = await _relay.RelayAndWaitAsync(
                agentId, "file.download",
                new { path = agentPath, offset, chunkSize = DownloadChunkSize },
                ct, TimeSpan.FromSeconds(DownloadTimeoutSeconds));
            if (next?.Data == null)
                break; // stream already started — nothing else we can do

            using var doc = JsonDocument.Parse(next.Data.Value.GetRawText());
            if (doc.RootElement.TryGetProperty("error", out _))
                break;

            done = doc.RootElement.TryGetProperty("done", out var d) && d.GetBoolean();
            offset += await WriteChunkAsync(doc, Response.Body, ct);
        }

        return new EmptyResult();
    }

    private static async Task<long> WriteChunkAsync(JsonDocument doc, Stream body, CancellationToken ct)
    {
        var data = doc.RootElement.GetProperty("data").GetString();
        if (string.IsNullOrEmpty(data))
            return 0;
        var bytes = Convert.FromBase64String(data);
        await body.WriteAsync(bytes, ct);
        await body.FlushAsync(ct);
        return bytes.LongLength;
    }
}

// ── Request DTOs ─────────────────────────────────────────────────────────────

public record ListRequest(string Path, int Offset = 0, int Limit = 200);
public record ReadRequest(string Path);
public record WriteRequest(string Path, string Content);
public record DeleteRequest(string Path);
public record MkdirRequest(string Path);
public record RenameRequest(string Path, string NewName);
public record MoveRequest(string Source, string Destination);
public record CopyRequest(string Source, string Destination);
public record CompressRequest(string Path);
public record DecompressRequest(string Path, string? Destination = null);
public record ShortcutRequest(string Path);
