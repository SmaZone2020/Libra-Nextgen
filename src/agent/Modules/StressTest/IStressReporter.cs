namespace LibraNextgen.Agent.Modules.StressTest;

public interface IStressReporter
{
    void IncrementPackets(long count = 1);
    void IncrementBytes(long count);
    void IncrementConnections(int delta = 1);
}
