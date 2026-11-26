using System.Net;
using Daymaker.Api.Auth;
using Daymaker.Api.Services;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

public record NoteDto(int Id, string Title, string ContentHtml, bool Pinned, int? FolderId, int? SourceTodoId, string[] Tags,
    DateTime CreatedUtc, DateTime UpdatedUtc, int AttachmentCount);
public record NoteInput(string Title, string? ContentHtml, bool? Pinned, int? FolderId, string[]? Tags);
public record ChecklistToTodoRequest(string Text, DateTime? DueUtc);
public record FolderInput(string Name);

[ApiController, Authorize, Route("api/v1/notes")]
public class NotesController(DaymakerDbContext db, TodoService todos, CurrentUser me) : ControllerBase
{
    private async Task<List<NoteDto>> ToDtos(IQueryable<Note> q)
    {
        var notes = await q.AsNoTracking().Include(n => n.Tags).ThenInclude(t => t.Tag).ToListAsync();
        var ids = notes.Select(n => n.Id).ToList();
        var counts = await db.Attachments.Where(a => a.OwnerType == AttachmentOwner.Note && ids.Contains(a.OwnerId))
            .GroupBy(a => a.OwnerId).Select(g => new { g.Key, N = g.Count() }).ToDictionaryAsync(x => x.Key, x => x.N);
        return notes.Select(n => new NoteDto(n.Id, n.Title, n.ContentHtml, n.Pinned, n.FolderId, n.SourceTodoId,
            n.Tags.Select(t => t.Tag.Name).ToArray(), DateTime.SpecifyKind(n.CreatedUtc, DateTimeKind.Utc),
            DateTime.SpecifyKind(n.UpdatedUtc, DateTimeKind.Utc), counts.GetValueOrDefault(n.Id))).ToList();
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int? folderId, [FromQuery] string? tag, [FromQuery] string? q, [FromQuery] bool? pinned)
    {
        var query = db.Notes.Where(n => n.UserId == me.Id);
        if (folderId is not null) query = query.Where(n => n.FolderId == folderId);
        if (pinned is not null) query = query.Where(n => n.Pinned == pinned);
        if (!string.IsNullOrWhiteSpace(tag)) query = query.Where(n => n.Tags.Any(t => t.Tag.Name == tag));
        if (!string.IsNullOrWhiteSpace(q)) { var pat = SqlText.Contains(q.Trim()); query = query.Where(n => EF.Functions.Like(n.Title, pat, SqlText.Escape) || EF.Functions.Like(n.ContentHtml, pat, SqlText.Escape)); }
        return Ok(await ToDtos(query.OrderByDescending(n => n.Pinned).ThenByDescending(n => n.UpdatedUtc)));
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var n = (await ToDtos(db.Notes.Where(x => x.Id == id && x.UserId == me.Id))).FirstOrDefault();
        return n is null ? NotFound() : Ok(n);
    }

    [HttpPost, RequireScope("write")]
    public async Task<IActionResult> Create(NoteInput i)
    {
        var n = new Note { UserId = me.Id };
        await Apply(n, i);
        db.Notes.Add(n);
        await db.SaveChangesAsync();
        return Ok((await ToDtos(db.Notes.Where(x => x.Id == n.Id))).First());
    }

    [HttpPut("{id:int}"), RequireScope("write")]
    public async Task<IActionResult> Update(int id, NoteInput i)
    {
        var n = await db.Notes.Include(x => x.Tags).FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (n is null) return NotFound();
        await Apply(n, i);
        await db.SaveChangesAsync();
        return Ok((await ToDtos(db.Notes.Where(x => x.Id == id))).First());
    }

    private async Task Apply(Note n, NoteInput i)
    {
        n.Title = string.IsNullOrWhiteSpace(i.Title) ? "Untitled" : i.Title.Trim();
        n.ContentHtml = i.ContentHtml ?? n.ContentHtml;
        n.Pinned = i.Pinned ?? n.Pinned;
        n.FolderId = i.FolderId;
        n.UpdatedUtc = DateTime.UtcNow;
        if (i.Tags is not null)
        {
            n.Tags.Clear();
            foreach (var name in i.Tags.Select(x => x.Trim()).Where(x => x.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase))
                n.Tags.Add(new NoteTag { Tag = await todos.GetOrCreateTag(me.Id, name) });
        }
    }

    [HttpPost("{id:int}/pin"), RequireScope("write")]
    public async Task<IActionResult> Pin(int id, [FromBody] bool pinned)
    {
        var n = await db.Notes.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (n is null) return NotFound();
        n.Pinned = pinned;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:int}"), RequireScope("delete")]
    public async Task<IActionResult> Delete(int id)
    {
        var n = await db.Notes.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (n is null) return NotFound();
        await db.Attachments.Where(a => a.OwnerType == AttachmentOwner.Note && a.OwnerId == id).ExecuteDeleteAsync();
        db.Notes.Remove(n);
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Turns one checklist line of a note into a todo linked back to the note.</summary>
    [HttpPost("{id:int}/checklist-to-todo"), RequireScope("write")]
    public async Task<IActionResult> ChecklistToTodo(int id, ChecklistToTodoRequest req)
    {
        var n = await db.Notes.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (n is null) return NotFound();
        if (string.IsNullOrWhiteSpace(req.Text)) return BadRequest(new ProblemDetails { Title = "Text is required" });
        var t = await todos.Create(me.Id, new TodoInput(req.Text.Trim(), $"From note: {n.Title}", req.DueUtc, null, null, null, null, null, null, null, null, null));
        return Ok(new { todoId = t.Id });
    }

    /// <summary>Creates a note from a todo (title, description, checklist, attachments), keeping a link to the task.</summary>
    [HttpPost("from-todo/{todoId:int}"), RequireScope("write")]
    public async Task<IActionResult> FromTodo(int todoId)
    {
        var t = await db.Todos.Include(x => x.Checklist).Include(x => x.Tags).ThenInclude(x => x.Tag)
            .FirstOrDefaultAsync(x => x.Id == todoId && x.UserId == me.Id);
        if (t is null) return NotFound();
        var html = $"<p>{WebUtility.HtmlEncode(t.Description).Replace("\n", "<br>")}</p>";
        if (t.Checklist.Count > 0)
            html += "<ul data-type=\"taskList\">" + string.Concat(t.Checklist.OrderBy(c => c.SortOrder).Select(c =>
                $"<li data-type=\"taskItem\" data-checked=\"{(c.Done ? "true" : "false")}\"><p>{WebUtility.HtmlEncode(c.Text)}</p></li>")) + "</ul>";
        var note = new Note { UserId = me.Id, Title = t.Title, ContentHtml = html, SourceTodoId = t.Id };
        foreach (var tg in t.Tags) note.Tags.Add(new NoteTag { TagId = tg.TagId });
        db.Notes.Add(note);
        await db.SaveChangesAsync();
        var atts = await db.Attachments.AsNoTracking().Where(a => a.OwnerType == AttachmentOwner.Todo && a.OwnerId == todoId).ToListAsync();
        foreach (var a in atts)
            db.Attachments.Add(new Attachment { UserId = me.Id, OwnerType = AttachmentOwner.Note, OwnerId = note.Id, FileName = a.FileName, ContentType = a.ContentType, Size = a.Size, Data = a.Data });
        await db.SaveChangesAsync();
        return Ok((await ToDtos(db.Notes.Where(x => x.Id == note.Id))).First());
    }
}

[ApiController, Authorize, Route("api/v1/folders")]
public class FoldersController(DaymakerDbContext db, CurrentUser me) : ControllerBase
{
    [HttpGet] public async Task<IActionResult> List() => Ok(await db.Folders.Where(f => f.UserId == me.Id).OrderBy(f => f.Name).ToListAsync());

    [HttpPost, RequireScope("write")]
    public async Task<IActionResult> Create(FolderInput i)
    {
        if (string.IsNullOrWhiteSpace(i.Name)) return BadRequest(new ProblemDetails { Title = "Name is required" });
        var f = new Folder { UserId = me.Id, Name = i.Name.Trim() };
        db.Folders.Add(f);
        await db.SaveChangesAsync();
        return Ok(f);
    }

    [HttpPut("{id:int}"), RequireScope("write")]
    public async Task<IActionResult> Rename(int id, FolderInput i)
    {
        var f = await db.Folders.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (f is null) return NotFound();
        f.Name = i.Name.Trim();
        await db.SaveChangesAsync();
        return Ok(f);
    }

    [HttpDelete("{id:int}"), RequireScope("delete")]
    public async Task<IActionResult> Delete(int id)
    {
        await db.Notes.Where(n => n.FolderId == id && n.UserId == me.Id).ExecuteUpdateAsync(s => s.SetProperty(n => n.FolderId, (int?)null));
        await db.Folders.Where(f => f.Id == id && f.UserId == me.Id).ExecuteDeleteAsync();
        return NoContent();
    }
}
