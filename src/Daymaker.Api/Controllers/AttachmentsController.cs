using Daymaker.Api.Auth;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

/// <summary>Attachments are stored as BLOBs in SQLite.</summary>
[ApiController, Authorize, Route("api/v1/attachments")]
public class AttachmentsController(DaymakerDbContext db, CurrentUser me) : ControllerBase
{
    public const long MaxBytes = 10 * 1024 * 1024;
    private static readonly string[] Allowed = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"];

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] AttachmentOwner owner, [FromQuery] int ownerId) =>
        Ok(await db.Attachments.Where(a => a.UserId == me.Id && a.OwnerType == owner && a.OwnerId == ownerId)
            .Select(a => new { a.Id, a.FileName, a.ContentType, a.Size, a.CreatedUtc }).ToListAsync());

    [HttpPost, RequireScope("write"), RequestSizeLimit(MaxBytes + 1024)]
    public async Task<IActionResult> Upload([FromQuery] AttachmentOwner owner, [FromQuery] int ownerId, IFormFile file)
    {
        if (file.Length == 0 || file.Length > MaxBytes) return BadRequest(new ProblemDetails { Title = "File must be between 1 byte and 10 MB" });
        if (!Allowed.Contains(file.ContentType)) return BadRequest(new ProblemDetails { Title = $"Unsupported file type {file.ContentType}" });
        var owns = owner == AttachmentOwner.Todo
            ? await db.Todos.AnyAsync(t => t.Id == ownerId && t.UserId == me.Id)
            : await db.Notes.AnyAsync(n => n.Id == ownerId && n.UserId == me.Id);
        if (!owns) return NotFound();
        using var ms = new MemoryStream();
        await file.CopyToAsync(ms);
        var a = new Attachment { UserId = me.Id, OwnerType = owner, OwnerId = ownerId, FileName = Path.GetFileName(file.FileName), ContentType = file.ContentType, Size = file.Length, Data = ms.ToArray() };
        db.Attachments.Add(a);
        await db.SaveChangesAsync();
        return Ok(new { a.Id, a.FileName, a.ContentType, a.Size });
    }

    [HttpGet("{id:int}/content")]
    public async Task<IActionResult> Content(int id)
    {
        var a = await db.Attachments.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        return a is null ? NotFound() : File(a.Data, a.ContentType, a.FileName);
    }

    [HttpDelete("{id:int}"), RequireScope("delete")]
    public async Task<IActionResult> Delete(int id)
    {
        await db.Attachments.Where(a => a.Id == id && a.UserId == me.Id).ExecuteDeleteAsync();
        return NoContent();
    }
}
