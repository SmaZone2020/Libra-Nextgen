using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using LibraNextgen.Common.Authorization;
using LibraNextgen.Common.Models;
using TaskStatus = LibraNextgen.Common.Models.TaskStatus;

namespace LibraNextgen.Service.Controllers;

[ApiController]
[Route("api/tasks")]
[Authorize]
public class TasksController : ControllerBase
{
    private readonly TaskService _taskService;

    public TasksController(TaskService taskService)
    {
        _taskService = taskService;
    }

    /// <summary>
    /// List all tasks with optional filters.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetAll(
        [FromQuery] string? status,
        [FromQuery] string? agentId,
        [FromQuery] int page = 1,
        [FromQuery] int pageSize = 50,
        CancellationToken ct = default)
    {
        TaskStatus? taskStatus = null;
        if (status != null)
        {
            if (Enum.TryParse<TaskStatus>(status, true, out var parsed))
                taskStatus = parsed;
            else
                return BadRequest(new { error = $"Invalid task status: {status}" });
        }
        var tasks = await _taskService.GetAllAsync(taskStatus, agentId, page, pageSize, ct);
        var total = await _taskService.CountAsync(taskStatus, ct);
        return Ok(new { tasks, total, page, pageSize });
    }

    /// <summary>
    /// Get task details by ID.
    /// </summary>
    [HttpGet("{id}")]
    public async Task<IActionResult> GetById(string id, CancellationToken ct)
    {
        var task = await _taskService.GetByIdAsync(id, ct);
        if (task == null) return NotFound();
        return Ok(task);
    }

    /// <summary>
    /// Create a new task for an agent.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] TaskCreateRequest request, CancellationToken ct)
    {
        if (CommandAuthorization.RequiresAdmin(request.CommandType) && !User.IsInRole("Admin"))
            return Forbid();

        var username = User.Identity?.Name ?? "unknown";
        var task = await _taskService.CreateAsync(request, username, User.IsInRole("Admin"), ct);
        return CreatedAtAction(nameof(GetById), new { id = task.Id }, task);
    }

    /// <summary>
    /// Cancel a pending task.
    /// </summary>
    [HttpDelete("{id}")]
    [Authorize(Roles = "Admin")]
    public async Task<IActionResult> Delete(string id, CancellationToken ct)
    {
        var deleted = await _taskService.DeleteAsync(id, ct);
        if (deleted == 0) return NotFound();
        return NoContent();
    }
}
