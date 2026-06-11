using System.Text;
using LibraNextgen.Agent.Core;
using LibraNextgen.Agent.Crypto;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

PersistenceManager.Apply();

var config = ConfigManager.Load(args);
var crypto = new AgentCrypto();

var shutdownTcs = new TaskCompletionSource();
Console.CancelKeyPress += (_, e) =>
{
    Console.WriteLine("[Agent] Shutting down...");
    e.Cancel = true;
    shutdownTcs.TrySetResult();
};

var baseDelay = TimeSpan.FromSeconds(5);
var maxDelay = TimeSpan.FromMinutes(5);
var stableThreshold = TimeSpan.FromSeconds(30);
var currentDelay = baseDelay;

using var cts = new CancellationTokenSource();

// Fire-and-forget: signal cancellation when Ctrl+C is pressed
_ = shutdownTcs.Task.ContinueWith(_ => cts.Cancel());

while (!cts.IsCancellationRequested)
{
    try
    {
        var engine = new AgentEngine(config, crypto);
        var startTime = DateTime.UtcNow;

        // RunAsync blocks until connection is lost or shutdown is requested
        await engine.RunAsync(cts.Token);

        // If we ran for a while, reset backoff
        if (DateTime.UtcNow - startTime > stableThreshold)
        {
            currentDelay = baseDelay;
            Console.WriteLine("[Agent] Connection lost. Reconnecting...");
        }
    }
    catch (OperationCanceledException)
    {
        break;
    }
    catch (Exception ex)
    {
        Console.WriteLine($"[Agent] Fatal error: {ex.Message}");
    }

    if (cts.IsCancellationRequested) break;

    // Exponential backoff with jitter
    var jitter = currentDelay.TotalMilliseconds * 0.25 * (Random.Shared.NextDouble() * 2 - 1);
    var waitMs = (int)(currentDelay.TotalMilliseconds + jitter);
    if (waitMs < 1000) waitMs = 1000;

    Console.WriteLine($"[Agent] Reconnecting in {waitMs / 1000}s...");
    try { await Task.Delay(waitMs, cts.Token); }
    catch (OperationCanceledException) { break; }

    currentDelay = TimeSpan.FromMilliseconds(Math.Min(currentDelay.TotalMilliseconds * 2, maxDelay.TotalMilliseconds));
}

Console.WriteLine("[Agent] Exited.");
