using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

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

    private async Task<IActionResult> RelayAndWaitAsync(string agentId, object data, CancellationToken ct, int timeoutSeconds = 60)
    {
        var response = await _relay.RelayAndWaitAsync(agentId, "files", data, ct,
            TimeSpan.FromSeconds(timeoutSeconds), createdBy: User.Identity?.Name ?? "system-relay");
        if (response == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });
        return Content(response, "application/json");
    }

    [HttpPost("{agentId}/list")]
    public async Task<IActionResult> ListDirectory(string agentId, [FromBody] ListRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "list", path = req.Path, offset = req.Offset, limit = req.Limit }, ct);
    }

    [HttpPost("{agentId}/drives")]
    public async Task<IActionResult> GetDrives(string agentId, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "drives" }, ct, 30);
    }

    [HttpPost("{agentId}/read")]
    public async Task<IActionResult> ReadFile(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "read", path = req.Path }, ct);
    }

    [HttpPost("{agentId}/open")]
    public async Task<IActionResult> OpenFile(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "open", path = req.Path }, ct);
    }

    [HttpPost("{agentId}/write")]
    public async Task<IActionResult> WriteFile(string agentId, [FromBody] WriteRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "write", path = req.Path, content = req.Content }, ct);
    }

    [HttpDelete("{agentId}")]
    public async Task<IActionResult> DeleteFile(string agentId, [FromBody] DeleteRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "delete", path = req.Path }, ct);
    }

    [HttpPost("{agentId}/mkdir")]
    public async Task<IActionResult> CreateDirectory(string agentId, [FromBody] MkdirRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "mkdir", path = req.Path }, ct);
    }

    [HttpPost("{agentId}/rename")]
    public async Task<IActionResult> Rename(string agentId, [FromBody] RenameRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "rename", path = req.Path, newName = req.NewName }, ct);
    }

    [HttpPost("{agentId}/move")]
    public async Task<IActionResult> Move(string agentId, [FromBody] MoveRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "move", path = req.Source, destination = req.Destination }, ct);
    }

    [HttpPost("{agentId}/copy")]
    public async Task<IActionResult> Copy(string agentId, [FromBody] CopyRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "copy", path = req.Source, destination = req.Destination }, ct);
    }

    [HttpPost("{agentId}/compress")]
    public async Task<IActionResult> Compress(string agentId, [FromBody] CompressRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "compress", path = req.Path }, ct);
    }

    [HttpPost("{agentId}/decompress")]
    public async Task<IActionResult> Decompress(string agentId, [FromBody] DecompressRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "decompress", path = req.Path, destination = req.Destination }, ct);
    }

    [HttpPost("{agentId}/shortcut")]
    public async Task<IActionResult> CreateShortcut(string agentId, [FromBody] ShortcutRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "shortcut", path = req.Path }, ct);
    }

    [HttpPost("{agentId}/archive/list")]
    public async Task<IActionResult> ListArchive(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        return await RelayAndWaitAsync(agentId, new { op = "archive_list", path = req.Path }, ct);
    }

    // Streaming download: fetched from the agent in chunks via task relay
    // (default 2 MB per round-trip) and written straight to the HTTP response
    // body — neither the server nor the agent ever holds the whole file.
    private const int DownloadChunkSize = 2 * 1024 * 1024;
    private const int DownloadTimeoutSeconds = 30;

    [HttpPost("{agentId}/download")]
    public async Task<IActionResult> Download(string agentId, [FromBody] ReadRequest req, CancellationToken ct)
    {
        var fileName = System.IO.Path.GetFileName(req.Path);
        var agentPath = req.Path;

        // First chunk doubles as a probe: errors surface as a normal 4xx.
        var first = await _relay.RelayAndWaitAsync(
            agentId, "files",
            new { op = "download", path = agentPath, offset = 0L, chunkSize = DownloadChunkSize },
            ct, TimeSpan.FromSeconds(DownloadTimeoutSeconds));
        if (first == null)
            return StatusCode(504, new { error = "Agent did not respond in time." });

        using var firstDoc = JsonDocument.Parse(first);
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
                agentId, "files",
                new { op = "download", path = agentPath, offset, chunkSize = DownloadChunkSize },
                ct, TimeSpan.FromSeconds(DownloadTimeoutSeconds));
            if (next == null)
                break; // stream already started — nothing else we can do

            using var doc = JsonDocument.Parse(next);
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

public record ListRequest(string Path, int Offset = 0, int Limit = 200);
public record ReadRequest(string Path);
public record WriteRequest(string Path, string Content);
public record DeleteRequest(string Path);
public record MkdirRequest(string Path);
public record RenameRequest(string Path, string NewName);
public record MoveRequest(string Source, string Destination);
public record CopyRequest(string Source, string Destination);
public record CompressRequest(string Path);
public record DecompressRequest(string Path, string? Destination);
public record ShortcutRequest(string Path);
