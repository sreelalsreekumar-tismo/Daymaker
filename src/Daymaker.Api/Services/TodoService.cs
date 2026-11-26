using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Services;

public record ChecklistDto(int? Id, string Text, bool Done);
public record TodoDto(int Id, int? ParentId, string Title, string Description, DateTime? DueUtc, DateTime? ReminderUtc,
    Priority Priority, TodoStatus Status, int? CategoryId, string? CategoryName, string? CategoryColor, Recurrence Recurrence,
    string? GoogleEventId, int SortOrder, DateTime CreatedUtc, DateTime? CompletedUtc,
    string[] Tags, ChecklistDto[] Checklist, int SubtaskCount, int SubtasksDone, int AttachmentCount, string? SyncError = null);

public record TodoInput(string Title, string? Description, DateTime? DueUtc, DateTime? ReminderUtc, Priority? Priority,
    TodoStatus? Status, int? CategoryId, Recurrence? Recurrence, int? ParentId, string[]? Tags, ChecklistDto[]? Checklist,
    bool? AddToCalendar);

public class TodoService(DaymakerDbContext db)
{
    public IQueryable<TodoItem> Query(int userId) => db.Todos.Where(t => t.UserId == userId);

    public async Task<List<TodoDto>> ToDtos(IQueryable<TodoItem> q)
    {
        var items = await q.AsNoTracking().Include(t => t.Category).Include(t => t.Checklist)
            .Include(t => t.Tags).ThenInclude(x => x.Tag).Include(t => t.Subtasks).ToListAsync();
        var ids = items.Select(i => i.Id).ToList();
        var counts = await db.Attachments.Where(a => a.OwnerType == AttachmentOwner.Todo && ids.Contains(a.OwnerId))
            .GroupBy(a => a.OwnerId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N);
        return items.Select(t => new TodoDto(t.Id, t.ParentId, t.Title, t.Description, Utc(t.DueUtc), Utc(t.ReminderUtc), t.Priority, t.Status,
            t.CategoryId, t.Category?.Name, t.Category?.Color, t.Recurrence, t.GoogleEventId, t.SortOrder, t.CreatedUtc, Utc(t.CompletedUtc),
            t.Tags.Select(x => x.Tag.Name).ToArray(),
            t.Checklist.OrderBy(c => c.SortOrder).Select(c => new ChecklistDto(c.Id, c.Text, c.Done)).ToArray(),
            t.Subtasks.Count, t.Subtasks.Count(s => s.Status == TodoStatus.Completed), counts.GetValueOrDefault(t.Id))).ToList();
    }

    private static DateTime? Utc(DateTime? d) => d is null ? null : DateTime.SpecifyKind(d.Value, DateTimeKind.Utc);

    public async Task<TodoItem> Create(int userId, TodoInput i)
    {
        var t = new TodoItem { UserId = userId };
        await Apply(t, i, userId);
        db.Todos.Add(t);
        await db.SaveChangesAsync();
        return t;
    }

    public async Task Apply(TodoItem t, TodoInput i, int userId)
    {
        t.Title = i.Title.Trim();
        t.Description = i.Description ?? t.Description;
        t.DueUtc = i.DueUtc?.ToUniversalTime();
        if (t.ReminderUtc != i.ReminderUtc?.ToUniversalTime()) t.ReminderSent = false;
        t.ReminderUtc = i.ReminderUtc?.ToUniversalTime();
        t.Priority = i.Priority ?? t.Priority;
        t.CategoryId = i.CategoryId;
        t.Recurrence = i.Recurrence ?? t.Recurrence;
        t.ParentId = i.ParentId ?? t.ParentId;
        if (i.Status is { } s) SetStatus(t, s);
        t.UpdatedUtc = DateTime.UtcNow;

        if (i.Checklist is not null)
        {
            db.ChecklistItems.RemoveRange(t.Checklist);
            t.Checklist = i.Checklist.Select((c, n) => new ChecklistItem { Text = c.Text, Done = c.Done, SortOrder = n }).ToList();
        }
        if (i.Tags is not null)
        {
            t.Tags.Clear();
            foreach (var name in i.Tags.Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
                t.Tags.Add(new TodoTag { Tag = await GetOrCreateTag(userId, name) });
        }
    }

    public async Task<Tag> GetOrCreateTag(int userId, string name)
    {
        var tag = await db.Tags.FirstOrDefaultAsync(x => x.UserId == userId && x.Name == name)
                  ?? db.Tags.Local.FirstOrDefault(x => x.UserId == userId && x.Name == name);
        if (tag is null) { tag = new Tag { UserId = userId, Name = name }; db.Tags.Add(tag); }
        return tag;
    }

    public void SetStatus(TodoItem t, TodoStatus status)
    {
        t.Status = status;
        t.CompletedUtc = status == TodoStatus.Completed ? DateTime.UtcNow : null;
    }

    /// <summary>Marks complete; recurring tasks spawn their next occurrence.</summary>
    public async Task<TodoItem?> Complete(TodoItem t)
    {
        if (t.Status == TodoStatus.Completed) return null;
        SetStatus(t, TodoStatus.Completed);
        t.UpdatedUtc = DateTime.UtcNow;
        TodoItem? next = null;
        if (t.Recurrence != Recurrence.None && t.DueUtc is { } due)
        {
            next = new TodoItem
            {
                UserId = t.UserId, Title = t.Title, Description = t.Description, Priority = t.Priority, CategoryId = t.CategoryId,
                Recurrence = t.Recurrence, ParentId = t.ParentId,
                DueUtc = t.Recurrence switch { Recurrence.Daily => due.AddDays(1), Recurrence.Weekly => due.AddDays(7), _ => due.AddMonths(1) },
                Checklist = t.Checklist.Select(c => new ChecklistItem { Text = c.Text, SortOrder = c.SortOrder }).ToList(),
                Tags = t.Tags.Select(x => new TodoTag { TagId = x.TagId }).ToList(),
            };
            db.Todos.Add(next);
        }
        await db.SaveChangesAsync();
        return next;
    }
}
