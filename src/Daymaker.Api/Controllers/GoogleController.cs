using Daymaker.Api.Auth;
using Daymaker.Api.Services;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Daymaker.Google;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

public record GoogleSettingsInput(string[] SelectedCalendars, bool TwoWaySync);
public record CalendarEventInput(string Title, string? Description, DateTime StartUtc, DateTime EndUtc, bool? AllDay, int? ReminderMinutes, string? CalendarId);

[ApiController, Route("api/v1/google")]
public class GoogleController(DaymakerDbContext db, IGoogleCalendarGateway gateway, GoogleSyncService sync, IDataProtectionProvider dp,
    CurrentUser me, IConfiguration config, GoogleOptions options) : ControllerBase
{
    private ITimeLimitedDataProtector StateProtector => dp.CreateProtector("google-oauth-state").ToTimeLimitedDataProtector();
    private string RedirectUri => options.RedirectUri ?? $"{Request.Scheme}://{Request.Host}/api/v1/google/callback";
    private string SpaUrl => (config.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:4200"])[0];

    [Authorize, HttpGet("status")]
    public async Task<IActionResult> Status()
    {
        var c = await sync.GetConnection(me.Id);
        return Ok(new
        {
            configured = gateway.IsConfigured,
            connected = c is not null,
            selectedCalendars = c is null ? Array.Empty<string>() : GoogleSyncService.Calendars(c),
            twoWaySync = c?.TwoWaySync ?? true,
            lastSyncUtc = c?.LastSyncUtc is { } d ? DateTime.SpecifyKind(d, DateTimeKind.Utc) : (DateTime?)null,
            lastError = c?.LastError,
        });
    }

    [Authorize, HttpGet("connect-url")]
    public IActionResult ConnectUrl()
    {
        if (!gateway.IsConfigured) return BadRequest(new ProblemDetails { Title = "Google is not configured on the server (Google:ClientId / Google:ClientSecret)." });
        var state = StateProtector.Protect(me.Id.ToString(), TimeSpan.FromMinutes(10));
        return Ok(new { url = gateway.BuildAuthUrl(state, RedirectUri) });
    }

    /// <summary>OAuth redirect target. Stores the refresh token (encrypted), runs the first sync and sends the browser back to the app.</summary>
    [HttpGet("callback")]
    public async Task<IActionResult> Callback([FromQuery] string? code, [FromQuery] string? state, [FromQuery] string? error)
    {
        if (error is not null || code is null || state is null) return Redirect($"{SpaUrl}/settings?google=denied");
        int userId;
        try { userId = int.Parse(StateProtector.Unprotect(state)); }
        catch { return Redirect($"{SpaUrl}/settings?google=error"); }
        try
        {
            var refresh = await gateway.ExchangeCodeForRefreshToken(code, RedirectUri);
            var conn = await sync.GetConnection(userId);
            if (conn is null) { conn = new GoogleConnection { UserId = userId }; db.GoogleConnections.Add(conn); }
            conn.RefreshTokenProtected = sync.Protect(refresh);
            conn.SyncToken = null; conn.LastError = null;
            await db.SaveChangesAsync();
            await sync.SyncUser(userId);
            return Redirect($"{SpaUrl}/settings?google=connected");
        }
        catch { return Redirect($"{SpaUrl}/settings?google=error"); }
    }

    [Authorize, HttpPost("disconnect"), RequireScope("delete")]
    public async Task<IActionResult> Disconnect()
    {
        var c = await sync.GetConnection(me.Id);
        if (c is null) return NoContent();
        await gateway.Revoke(sync.Unprotect(c.RefreshTokenProtected));
        db.GoogleConnections.Remove(c);
        await db.CalendarEvents.Where(e => e.UserId == me.Id).ExecuteDeleteAsync();
        await db.Todos.Where(t => t.UserId == me.Id && t.GoogleEventId != null).ExecuteUpdateAsync(s => s.SetProperty(t => t.GoogleEventId, (string?)null));
        await db.SaveChangesAsync();
        return NoContent();
    }

    [Authorize, HttpGet("calendars")]
    public async Task<IActionResult> Calendars()
    {
        var c = await sync.GetConnection(me.Id);
        if (c is null) return BadRequest(new ProblemDetails { Title = "Google Calendar is not connected." });
        try
        {
            var selected = GoogleSyncService.Calendars(c);
            return Ok((await gateway.ListCalendars(sync.Unprotect(c.RefreshTokenProtected)))
                .Select(x => new { x.Id, x.Name, x.Primary, selected = selected.Contains(x.Id) || (x.Primary && selected.Contains("primary")) }));
        }
        catch (Exception ex) { return StatusCode(502, new ProblemDetails { Title = "Could not load calendars: " + ex.Message }); }
    }

    [Authorize, HttpPut("settings"), RequireScope("write")]
    public async Task<IActionResult> Settings(GoogleSettingsInput i)
    {
        var c = await sync.GetConnection(me.Id);
        if (c is null) return BadRequest(new ProblemDetails { Title = "Google Calendar is not connected." });
        if (i.SelectedCalendars.Length == 0) return BadRequest(new ProblemDetails { Title = "Select at least one calendar." });
        var removed = GoogleSyncService.Calendars(c).Except(i.SelectedCalendars).ToList();
        c.SelectedCalendars = string.Join(',', i.SelectedCalendars);
        c.TwoWaySync = i.TwoWaySync;
        c.SyncToken = null; // calendar set changed: re-import from scratch
        foreach (var cal in removed) await db.CalendarEvents.Where(e => e.UserId == me.Id && e.CalendarId == cal && e.LinkedTodoId == null).ExecuteDeleteAsync();
        await db.SaveChangesAsync();
        await sync.SyncUser(me.Id);
        return NoContent();
    }

    [Authorize, HttpPost("sync")]
    public async Task<IActionResult> SyncNow()
    {
        if (await sync.GetConnection(me.Id) is null) return BadRequest(new ProblemDetails { Title = "Google Calendar is not connected." });
        var r = await sync.SyncUser(me.Id);
        var c = await db.GoogleConnections.AsNoTracking().FirstAsync(g => g.UserId == me.Id);
        return Ok(new { r.Added, r.Changed, r.Removed, lastSyncUtc = c.LastSyncUtc, lastError = c.LastError });
    }
}

[ApiController, Authorize, Route("api/v1/calendar")]
public class CalendarController(DaymakerDbContext db, CalendarPushService push, CurrentUser me) : ControllerBase
{
    private static object Dto(CalendarEvent e) => new
    {
        e.Id, e.Title, e.Description, e.Location, e.AllDay, e.CalendarId, e.LinkedTodoId,
        StartUtc = DateTime.SpecifyKind(e.StartUtc, DateTimeKind.Utc), EndUtc = DateTime.SpecifyKind(e.EndUtc, DateTimeKind.Utc),
    };

    [HttpGet("events")]
    public async Task<IActionResult> Events([FromQuery] DateTime? from, [FromQuery] DateTime? to)
    {
        var f = (from ?? DateTime.UtcNow.Date).ToUniversalTime();
        var t = (to ?? f.AddDays(30)).ToUniversalTime();
        return Ok((await db.CalendarEvents.AsNoTracking().Where(e => e.UserId == me.Id && e.EndUtc >= f && e.StartUtc <= t).OrderBy(e => e.StartUtc).ToListAsync()).Select(Dto));
    }

    private static GEventInput ToInput(CalendarEventInput i) =>
        new(i.Title.Trim(), i.Description ?? "", i.StartUtc.ToUniversalTime(), i.EndUtc.ToUniversalTime(), i.AllDay ?? false, i.ReminderMinutes);

    private static string? Validate(CalendarEventInput i) =>
        string.IsNullOrWhiteSpace(i.Title) ? "Title is required" : i.EndUtc < i.StartUtc ? "End must not be before start" : null;

    [HttpPost("events"), RequireScope("write")]
    public async Task<IActionResult> Create(CalendarEventInput i)
    {
        if (Validate(i) is { } err) return BadRequest(new ProblemDetails { Title = err });
        try
        {
            var ev = await push.CreateEvent(me.Id, i.CalendarId ?? CalendarPushService.DefaultCalendar, ToInput(i));
            return Ok(Dto(await db.CalendarEvents.AsNoTracking().FirstAsync(e => e.UserId == me.Id && e.GoogleEventId == ev.Id)));
        }
        catch (InvalidOperationException ex) { return BadRequest(new ProblemDetails { Title = ex.Message }); }
        catch (Exception ex) { return StatusCode(502, new ProblemDetails { Title = "Google Calendar rejected the change: " + ex.Message }); }
    }

    [HttpPut("events/{id:int}"), RequireScope("write")]
    public async Task<IActionResult> Update(int id, CalendarEventInput i)
    {
        if (Validate(i) is { } err) return BadRequest(new ProblemDetails { Title = err });
        var e = await db.CalendarEvents.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (e is null) return NotFound();
        try { await push.UpdateEvent(e, ToInput(i)); return Ok(Dto(await db.CalendarEvents.AsNoTracking().FirstAsync(x => x.Id == id))); }
        catch (InvalidOperationException ex) { return BadRequest(new ProblemDetails { Title = ex.Message }); }
        catch (Exception ex) { return StatusCode(502, new ProblemDetails { Title = "Google Calendar rejected the change: " + ex.Message }); }
    }

    [HttpDelete("events/{id:int}"), RequireScope("delete")]
    public async Task<IActionResult> Delete(int id)
    {
        var e = await db.CalendarEvents.FirstOrDefaultAsync(x => x.Id == id && x.UserId == me.Id);
        if (e is null) return NotFound();
        try { await push.DeleteEvent(e); return NoContent(); }
        catch (Exception ex) { return StatusCode(502, new ProblemDetails { Title = "Google Calendar rejected the change: " + ex.Message }); }
    }
}
