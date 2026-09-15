using LibraNextgen.Service;

// Thin entry point. The host bootstrap lives in LibraServiceHost so the exact
// same service can be spawned as a desktop sidecar, run as a bare-metal/cloud
// process, or hosted in-process by the mobile app (which cannot spawn one).
// Contract and behaviour are unchanged.
await LibraServiceHost.RunAsync(args);

/// <summary>Exposed for WebApplicationFactory-based integration tests.</summary>
public partial class Program { }
