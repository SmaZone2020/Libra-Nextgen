using LibraNextgen.Common.Models;

namespace LibraNextgen.Agent.Modules.StressTest;

public interface IStressMethod
{
    string Name { get; }
    Task ExecuteAsync(StressConfig config, IStressReporter reporter, CancellationToken ct);
}
