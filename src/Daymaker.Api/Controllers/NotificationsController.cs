using Daymaker.Api.Auth;
using Daymaker.Api.Services;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

[ApiController, Authorize, Route("api/v1/notifications")]
public class NotificationsController(DaymakerDbContext db, CurrentUser me) : ControllerBase
{
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] bool unreadOnly = false, [FromQuery] int take = 50)
    {
        var q = db.Notifications.AsNoTracking().Where(n => n.UserId == me.Id);
        if (unreadOnly) q = q.Where(n => !n.Read);
        var items = await q.OrderByDescending(n => n.CreatedUtc).Take(Math.Clamp(take, 1, 200)).ToListAsync();
        return Ok(new { unread = await db.Notifications.CountAsync(n => n.UserId == me.Id && !n.Read), items = items.Select(NotificationService.Dto) });
    }

    [HttpPost("{id:int}/read")]
    public async Task<IActionResult> MarkRead(int id)
    {
        await db.Notifications.Where(n => n.Id == id && n.UserId == me.Id).ExecuteUpdateAsync(s => s.SetProperty(n => n.Read, true));
        return NoContent();
    }

    [HttpPost("read-all")]
    public async Task<IActionResult> ReadAll()
    {
        await db.Notifications.Where(n => n.UserId == me.Id && !n.Read).ExecuteUpdateAsync(s => s.SetProperty(n => n.Read, true));
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        await db.Notifications.Where(n => n.Id == id && n.UserId == me.Id).ExecuteDeleteAsync();
        return NoContent();
    }

    [HttpDelete]
    public async Task<IActionResult> Clear()
    {
        await db.Notifications.Where(n => n.UserId == me.Id).ExecuteDeleteAsync();
        return NoContent();
    }
}
