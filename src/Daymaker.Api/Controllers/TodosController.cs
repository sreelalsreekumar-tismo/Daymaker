using Daymaker.Api.Auth;
using Daymaker.Api.Services;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

public record StatusRequest(TodoStatus Status, int? SortOrder);

[ApiController, Authorize]
[Route("api/v1/todos")]
public class TodosController(DaymakerDbContext db, TodoService svc, CurrentUser me, NotificationService notifier, CalendarPushService calendar) : ControllerBase
{
    private bool ViaApiToken => User.Identity?.AuthenticationType == ApiTokenHandler.Scheme;

    /// <summary>Changes made through an API token (e.g. by Claude) surface in the notification center.</summary>
    private Task Announce(string what, string title, int id) => ViaApiToken
        ? notifier.Notify(me.Id, NotificationType.TaskUpdated, $"Task {what}", title, "todo", id)
        : Task.CompletedTask;

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] TodoStatus? status, [FromQuery] Priority? priority, [FromQuery] int? categoryId,
        [FromQuery] string? tag, [FromQuery] DateTime? from, [FromQuery] DateTime? to, [FromQuery] string? q,
        [FromQuery] bool topLevel = true, [FromQuery] bool? overdue = null)
    {
        var query = svc.Query(me.Id);
        if (topLevel) query = query.Where(t => t.ParentId == null);
        if (status is not null) query = query.Where(t => t.Status == status);
        if (priority is not null) query = query.Where(t => t.Priority == priority);
        if (categoryId is not null) query = query.Where(t => t.CategoryId == categoryId);
        if (!string.IsNullOrWhiteSpace(tag)) query = query.Where(t => t.Tags.Any(x => x.Tag.Name == tag));
        if (from is not null) query = query.Where(t => t.DueUtc >= from.Value.ToUniversalTime());
        if (to is not null) query = query.Where(t => t.DueUtc <= to.Value.ToUniversalTime());
        if (overdue == true) query = query.Where(t => t.Status != TodoStatus.Completed && t.DueUtc < DateTime.UtcNow);
        if (!string.IsNullOrWhiteSpace(q)) { var pat = SqlText.Contains(q.Trim()); query = query.Where(t => EF.Functions.Like(t.Title, pat, SqlText.Escape) || EF.Functions.Like(t.Description, pat, SqlText.Escape)); }
        return Ok(await svc.ToDtos(query.OrderBy(t => t.Status == TodoStatus.Completed).ThenBy(t => t.SortOrder).ThenBy(t => t.DueUtc ?? DateTime.MaxValue)));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var dto = (await svc.ToDtos(svc.Query(me.Id).Where(t => t.Id == id))).FirstOrDefault();
        return dto is null ? NotFound() : Ok(dto);
    }

    [HttpGet("{id:int}/subtasks")]
    public async Task<IActionResult> Subtasks(int id) =>
        Ok(await svc.ToDtos(svc.Query(me.Id).Where(t => t.ParentId == id).OrderBy(t => t.SortOrder)));

    [HttpPost, RequireScope("write")]
    public async Task<IActionResult> Create(TodoInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return BadRequest(new ProblemDetails { Title = "Title is required" });
        var t = await svc.Create(me.Id, input);
        await Announce("created", t.Title, t.Id);
        var syncError = await calendar.PushTodo(t, input.AddToCalendar == true);
        var dto = (await svc.ToDtos(svc.Query(me.Id).Where(x => x.Id == t.Id))).First() with { SyncError = syncError };
        return CreatedAtAction(nameof(Get), new { id = t.Id }, dto);
    }

    [HttpPut("{id:int}"), RequireScope("write")]
    public async Task<IActionResult> Update(int id, TodoInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return BadRequest(new ProblemDetails { Title = "Title is required" });
        var t = await svc.Query(me.Id).Include(x => x.Checklist).Include(x => x.Tags).FirstOrDefaultAsync(x => x.Id == id);
        if (t is null) return NotFound();
        var wasDone = t.Status == TodoStatus.Completed;
        await svc.Apply(t, input, me.Id);
        await db.SaveChangesAsync();
        await Announce("updated", t.Title, t.Id);
        if (!wasDone && t.Status == TodoStatus.Completed && t.Recurrence != Recurrence.None) { t.Status = TodoStatus.InProgress; await svc.Complete(t); }
        var syncError = await calendar.PushTodo(t, input.AddToCalendar == true);
        return Ok((await svc.ToDtos(svc.Query(me.Id).Where(x => x.Id == id))).First() with { SyncError = syncError });
    }

    [HttpPost("{id:int}/complete"), RequireScope("write")]
    public async Task<IActionResult> Complete(int id)
    {
        var t = await svc.Query(me.Id).Include(x => x.Checklist).Include(x => x.Tags).FirstOrDefaultAsync(x => x.Id == id);
        if (t is null) return NotFound();
        var next = await svc.Complete(t);
        await Announce("completed", t.Title, t.Id);
        return Ok(new { completed = id, next = next?.Id });
    }

    /// <summary>Used by Kanban drag-and-drop.</summary>
    [HttpPatch("{id:int}/status"), RequireScope("write")]
    public async Task<IActionResult> SetStatus(int id, StatusRequest req)
    {
        var t = await svc.Query(me.Id).Include(x => x.Checklist).Include(x => x.Tags).FirstOrDefaultAsync(x => x.Id == id);
        if (t is null) return NotFound();
        if (req.Status == TodoStatus.Completed) await svc.Complete(t);
        else { svc.SetStatus(t, req.Status); t.UpdatedUtc = DateTime.UtcNow; }
        if (req.SortOrder is { } o) t.SortOrder = o;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPut("{id:int}/checklist/{itemId:int}"), RequireScope("write")]
    public async Task<IActionResult> ToggleChecklist(int id, int itemId, [FromBody] bool done)
    {
        var c = await db.ChecklistItems.FirstOrDefaultAsync(x => x.Id == itemId && x.TodoItemId == id && db.Todos.Any(t => t.Id == id && t.UserId == me.Id));
        if (c is null) return NotFound();
        c.Done = done;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:int}"), RequireScope("delete")]
    public async Task<IActionResult> Delete(int id)
    {
        var t = await svc.Query(me.Id).FirstOrDefaultAsync(x => x.Id == id);
        if (t is null) return NotFound();
        var syncError = await calendar.RemoveTodoEvent(t);
        await db.Attachments.Where(a => a.OwnerType == AttachmentOwner.Todo && a.OwnerId == id).ExecuteDeleteAsync();
        db.Todos.Remove(t);
        await db.SaveChangesAsync();
        await Announce("deleted", t.Title, id);
        if (syncError is not null) Response.Headers["X-Sync-Warning"] = syncError;
        return NoContent();
    }
}
