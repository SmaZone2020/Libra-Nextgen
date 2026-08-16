using LibraNextgen.Common.Models;
using LibraNextgen.Service.Services;
using Xunit;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Tests;

public class TaskServiceFilterTests
{
    [Fact]
    public void CollectFilters_NoCriteria_IsEmpty()
    {
        Assert.Empty(TaskService.CollectFilters(null, null));
    }

    [Fact]
    public void CollectFilters_StatusOnly_IsSingle()
    {
        Assert.Single(TaskService.CollectFilters(TaskStatus.Pending, null));
    }

    [Fact]
    public void CollectFilters_AgentOnly_IsSingle()
    {
        Assert.Single(TaskService.CollectFilters(null, "agent-1"));
    }

    [Fact]
    public void CollectFilters_StatusAndAgent_IsTwo()
    {
        Assert.Equal(2, TaskService.CollectFilters(TaskStatus.Pending, "agent-1").Count);
    }
}
