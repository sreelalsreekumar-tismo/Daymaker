using Daymaker.Api.Auth;
using Daymaker.Api.Services;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

public record SearchHit(string Kind, int Id, string Title, string Snippet, DateTime? Date, int? ParentId = null, string? ParentKind = null);

[ApiController, Authorize, Route("api/v1/search")]
public class SearchController(DaymakerDbContext db, CurrentUser me) : ControllerBase
{
    /// <summary>Searches todos, notes, calendar events and attachment file names. kinds = todo,note,event,attachment (default all).</summary>
    [HttpGet]
    public async Task<IActionResult> Search([FromQuery] string q, [FromQuery] string? kinds, [FromQuery] int limit = 10)
    {
        if (string.IsNullOrWhiteSpace(q)) return Ok(Array.Empty<SearchHit>());
        q = q.Trim();
        var pat = SqlText.Contains(q);
        limit = Math.Clamp(limit, 1, 50);
        var want = (kinds ?? "todo,note,event,attachment").Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var hits = new List<SearchHit>();

        if (want.Contains("todo"))
            hits.AddRange((await db.Todos.AsNoTracking().Where(t => t.UserId == me.Id &&
                    (EF.Functions.Like(t.Title, pat, SqlText.Escape) || EF.Functions.Like(t.Description, pat, SqlText.Escape) || t.Tags.Any(x => EF.Functions.Like(x.Tag.Name, pat, SqlText.Escape)) || t.Checklist.Any(c => EF.Functions.Like(c.Text, pat, SqlText.Escape))))
                .OrderByDescending(t => t.UpdatedUtc).Take(limit).ToListAsync())
                .Select(t => new SearchHit("todo", t.Id, t.Title, Snip(t.Description, q), t.DueUtc)));

        if (want.Contains("note"))
            hits.AddRange((await db.Notes.AsNoTracking().Where(n => n.UserId == me.Id &&
                    (EF.Functions.Like(n.Title, pat, SqlText.Escape) || EF.Functions.Like(n.ContentHtml, pat, SqlText.Escape) || n.Tags.Any(x => EF.Functions.Like(x.Tag.Name, pat, SqlText.Escape))))
                .OrderByDescending(n => n.UpdatedUtc).Take(limit).ToListAsync())
                .Select(n => new SearchHit("note", n.Id, n.Title, Snip(StripTags(n.ContentHtml), q), n.UpdatedUtc)));

        if (want.Contains("event"))
            hits.AddRange((await db.CalendarEvents.AsNoTracking().Where(e => e.UserId == me.Id && (EF.Functions.Like(e.Title, pat, SqlText.Escape) || EF.Functions.Like(e.Description, pat, SqlText.Escape) || EF.Functions.Like(e.Location ?? "", pat, SqlText.Escape)))
                .OrderByDescending(e => e.StartUtc).Take(limit).ToListAsync())
                .Select(e => new SearchHit("event", e.Id, e.Title, Snip(e.Description, q), e.StartUtc)));

        if (want.Contains("attachment"))
            hits.AddRange((await db.Attachments.AsNoTracking().Where(a => a.UserId == me.Id && EF.Functions.Like(a.FileName, pat, SqlText.Escape))
                .OrderByDescending(a => a.CreatedUtc).Take(limit)
                .Select(a => new { a.Id, a.FileName, a.OwnerType, a.OwnerId, a.CreatedUtc }).ToListAsync())
                .Select(a => new SearchHit("attachment", a.Id, a.FileName, a.OwnerType == AttachmentOwner.Todo ? "Attached to a task" : "Attached to a note", a.CreatedUtc, a.OwnerId, a.OwnerType == AttachmentOwner.Todo ? "todo" : "note")));

        return Ok(hits);
    }

    private static string StripTags(string html) => System.Text.RegularExpressions.Regex.Replace(html, "<[^>]+>", " ");

    private static string Snip(string text, string q)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var i = text.IndexOf(q, StringComparison.OrdinalIgnoreCase);
        if (i < 0) return text.Length > 100 ? text[..100] + "…" : text;
        var start = Math.Max(0, i - 40);
        var len = Math.Min(text.Length - start, 100);
        return (start > 0 ? "…" : "") + text.Substring(start, len).Trim() + (start + len < text.Length ? "…" : "");
    }
}
