using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services.Tasks;
using Xunit;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Tests;

public class TaskServiceFilterTests
{
    private static AgentTask Task(string agentId, TaskStatus status) => new()
    {
        Id = Guid.NewGuid().ToString("N"),
        AgentId = agentId,
        Status = status,
    };

    [Fact]
    public void BuildFilter_NoCriteria_MatchesEverything()
    {
        var filter = TaskService.BuildFilter(null, null).Compile();
        Assert.True(filter(Task("a1", TaskStatus.Pending)));
        Assert.True(filter(Task("a2", TaskStatus.Completed)));
    }

    [Fact]
    public void BuildFilter_StatusOnly_MatchesStatus()
    {
        var filter = TaskService.BuildFilter(TaskStatus.Pending, null).Compile();
        Assert.True(filter(Task("a", TaskStatus.Pending)));
        Assert.False(filter(Task("a", TaskStatus.Completed)));
    }

    [Fact]
    public void BuildFilter_AgentOnly_MatchesAgent()
    {
        var filter = TaskService.BuildFilter(null, "a1").Compile();
        Assert.True(filter(Task("a1", TaskStatus.Pending)));
        Assert.False(filter(Task("a2", TaskStatus.Pending)));
    }

    [Fact]
    public void BuildFilter_StatusAndAgent_BothMustMatch()
    {
        var filter = TaskService.BuildFilter(TaskStatus.Pending, "a1").Compile();
        Assert.True(filter(Task("a1", TaskStatus.Pending)));
        Assert.False(filter(Task("a1", TaskStatus.Completed)));
        Assert.False(filter(Task("a2", TaskStatus.Pending)));
    }
}
