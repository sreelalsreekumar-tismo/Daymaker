using System.Text.Json;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Daymaker.Google;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Services;

public record SyncResult(int Added, int Changed, int Removed);

/// <summary>Two-way sync between Google Calendar and the local event cache / linked todos.</summary>
public class GoogleSyncService(DaymakerDbContext db, IGoogleCalendarGateway gateway, IDataProtectionProvider dp, NotificationService notifier)
{
    private readonly IDataProtector _protector = dp.CreateProtector("google-refresh-token");
    public static readonly TimeSpan PastWindow = TimeSpan.FromDays(30), FutureWindow = TimeSpan.FromDays(180);

    public string Protect(string token) => _protector.Protect(token);
    public string Unprotect(string protectedToken) => _protector.Unprotect(protectedToken);

    public Task<GoogleConnection?> GetConnection(int userId) => db.GoogleConnections.FirstOrDefaultAsync(g => g.UserId == userId);

    public static string[] Calendars(GoogleConnection c) =>
        c.SelectedCalendars.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) is { Length: > 0 } a ? a : ["primary"];

    /// <summary>Pulls changes for all selected calendars. Errors are recorded on the connection (visible as sync status) instead of thrown.</summary>
    public async Task<SyncResult> SyncUser(int userId)
    {
        var conn = await GetConnection(userId);
        if (conn is null) return new(0, 0, 0);
        int added = 0, changed = 0, removed = 0;
        try
        {
            var refresh = Unprotect(conn.RefreshTokenProtected);
            var tokens = string.IsNullOrEmpty(conn.SyncToken) ? new() : JsonSerializer.Deserialize<Dictionary<string, string>>(conn.SyncToken) ?? new();
            var now = DateTime.UtcNow;
            foreach (var cal in Calendars(conn))
            {
                var changes = await gateway.ListChanges(refresh, cal, tokens.GetValueOrDefault(cal), now - PastWindow, now + FutureWindow);
                var firstSync = !tokens.ContainsKey(cal); // don't flood notifications while importing history
                var seen = new HashSet<string>();
                foreach (var ev in changes.Events)
                {
                    seen.Add(ev.Id);
                    var r = await Apply(userId, conn, ev, announce: !firstSync && !changes.FullSync);
                    added += r.Added; changed += r.Changed; removed += r.Removed;
                }
                if (changes.FullSync)
                {
                    var stale = await db.CalendarEvents.Where(e => e.UserId == userId && e.CalendarId == cal).ToListAsync();
                    foreach (var e in stale.Where(e => !seen.Contains(e.GoogleEventId))) { db.CalendarEvents.Remove(e); removed++; }
                }
                if (changes.NextSyncToken is not null) tokens[cal] = changes.NextSyncToken;
            }
            conn.SyncToken = JsonSerializer.Serialize(tokens);
            conn.LastSyncUtc = DateTime.UtcNow;
            conn.LastError = null;
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            db.ChangeTracker.Clear();
            await db.GoogleConnections.Where(g => g.Id == conn.Id).ExecuteUpdateAsync(s => s.SetProperty(g => g.LastError, Truncate(ex.Message)));
        }
        return new(added, changed, removed);
    }

    private static string Truncate(string s) => s.Length > 300 ? s[..300] : s;

    private async Task<SyncResult> Apply(int userId, GoogleConnection conn, GEvent ev, bool announce)
    {
        var cached = await db.CalendarEvents.FirstOrDefaultAsync(e => e.UserId == userId && e.GoogleEventId == ev.Id);

        if (ev.Cancelled)
        {
            if (cached is null) return new(0, 0, 0);
            db.CalendarEvents.Remove(cached);
            if (announce) await notifier.Notify(userId, NotificationType.MeetingChanged, "Meeting cancelled", cached.Title, "event", null);
            return new(0, 0, 1);
        }

        if (cached is null)
        {
            var linked = await db.Todos.FirstOrDefaultAsync(t => t.UserId == userId && t.GoogleEventId == ev.Id);
            cached = new CalendarEvent { UserId = userId, GoogleEventId = ev.Id, CalendarId = ev.CalendarId, LinkedTodoId = linked?.Id };
            Copy(cached, ev);
            db.CalendarEvents.Add(cached);
            await db.SaveChangesAsync();
            if (announce && linked is null)
                await notifier.Notify(userId, NotificationType.MeetingAdded, "New meeting", $"{ev.Title} · {ev.StartUtc:ddd MMM d HH:mm} UTC", "event", cached.Id);
            return new(1, 0, 0);
        }

        if (cached.ETag == ev.ETag) return new(0, 0, 0); // our own push echoing back, or no real change
        Copy(cached, ev);
        if (cached.LinkedTodoId is { } todoId && conn.TwoWaySync)
        {
            var todo = await db.Todos.FirstOrDefaultAsync(t => t.Id == todoId && t.UserId == userId);
            if (todo is not null)
            {
                todo.Title = ev.Title; todo.DueUtc = ev.StartUtc; todo.UpdatedUtc = DateTime.UtcNow;
                if (announce) await notifier.Notify(userId, NotificationType.TaskUpdated, "Task updated from Google Calendar", todo.Title, "todo", todo.Id);
            }
        }
        else if (announce)
            await notifier.Notify(userId, NotificationType.MeetingChanged, "Meeting changed", $"{ev.Title} · {ev.StartUtc:ddd MMM d HH:mm} UTC", "event", cached.Id);
        await db.SaveChangesAsync();
        return new(0, 1, 0);
    }

    private static void Copy(CalendarEvent c, GEvent e)
    {
        c.Title = e.Title; c.Description = e.Description; c.Location = e.Location;
        c.StartUtc = e.StartUtc; c.EndUtc = e.EndUtc; c.AllDay = e.AllDay; c.ETag = e.ETag; c.UpdatedUtc = DateTime.UtcNow;
    }
}

/// <summary>Pushes todo and direct calendar changes to Google. Failures never block local saves; they are reported to the caller.</summary>
public class CalendarPushService(DaymakerDbContext db, IGoogleCalendarGateway gateway, GoogleSyncService sync)
{
    public const string DefaultCalendar = "primary";

    /// <summary>Creates or updates the Google event for a todo. Returns an error message, or null on success/no-op.</summary>
    public async Task<string?> PushTodo(TodoItem t, bool createIfMissing)
    {
        var conn = await sync.GetConnection(t.UserId);
        if (t.GoogleEventId is null && !createIfMissing) return null;
        if (conn is null) return t.GoogleEventId is null ? "Google Calendar is not connected." : null;
        if (t.DueUtc is not { } due) return t.GoogleEventId is null ? "A due date is required to add a task to Google Calendar." : null;
        try
        {
            var refresh = sync.Unprotect(conn.RefreshTokenProtected);
            var input = new GEventInput(t.Title, t.Description, due, due.AddMinutes(30), false,
                t.ReminderUtc is { } r && r < due ? (int)(due - r).TotalMinutes : null);
            GEvent ev;
            if (t.GoogleEventId is null)
            {
                ev = await gateway.Insert(refresh, DefaultCalendar, input);
                t.GoogleEventId = ev.Id;
            }
            else ev = await gateway.Update(refresh, DefaultCalendar, t.GoogleEventId, input);
            await Cache(t.UserId, ev, t.Id);
            await db.SaveChangesAsync();
            return null;
        }
        catch (Exception ex) { return "Saved, but Google Calendar sync failed: " + ex.Message; }
    }

    public async Task<string?> RemoveTodoEvent(TodoItem t)
    {
        if (t.GoogleEventId is null) return null;
        var conn = await sync.GetConnection(t.UserId);
        if (conn is null) return null;
        try
        {
            await gateway.Delete(sync.Unprotect(conn.RefreshTokenProtected), DefaultCalendar, t.GoogleEventId);
            await db.CalendarEvents.Where(e => e.UserId == t.UserId && e.GoogleEventId == t.GoogleEventId).ExecuteDeleteAsync();
            return null;
        }
        catch (Exception ex) { return "Deleted, but removing the Google Calendar event failed: " + ex.Message; }
    }

    public async Task<CalendarEvent> Cache(int userId, GEvent ev, int? todoId = null)
    {
        var c = await db.CalendarEvents.FirstOrDefaultAsync(e => e.UserId == userId && e.GoogleEventId == ev.Id);
        if (c is null) { c = new CalendarEvent { UserId = userId, GoogleEventId = ev.Id }; db.CalendarEvents.Add(c); }
        c.CalendarId = ev.CalendarId; c.Title = ev.Title; c.Description = ev.Description; c.Location = ev.Location;
        c.StartUtc = ev.StartUtc; c.EndUtc = ev.EndUtc; c.AllDay = ev.AllDay; c.ETag = ev.ETag; c.UpdatedUtc = DateTime.UtcNow;
        c.LinkedTodoId = todoId ?? c.LinkedTodoId;
        await db.SaveChangesAsync();
        return c;
    }

    public async Task<GEvent> CreateEvent(int userId, string calendarId, GEventInput input)
    {
        var conn = await sync.GetConnection(userId) ?? throw new InvalidOperationException("Google Calendar is not connected.");
        var ev = await gateway.Insert(sync.Unprotect(conn.RefreshTokenProtected), calendarId, input);
        await Cache(userId, ev);
        return ev;
    }

    public async Task<GEvent> UpdateEvent(CalendarEvent cached, GEventInput input)
    {
        var conn = await sync.GetConnection(cached.UserId) ?? throw new InvalidOperationException("Google Calendar is not connected.");
        var ev = await gateway.Update(sync.Unprotect(conn.RefreshTokenProtected), cached.CalendarId, cached.GoogleEventId, input);
        await Cache(cached.UserId, ev);
        return ev;
    }

    public async Task DeleteEvent(CalendarEvent cached)
    {
        var conn = await sync.GetConnection(cached.UserId) ?? throw new InvalidOperationException("Google Calendar is not connected.");
        await gateway.Delete(sync.Unprotect(conn.RefreshTokenProtected), cached.CalendarId, cached.GoogleEventId);
        db.CalendarEvents.Remove(cached);
        await db.SaveChangesAsync();
    }
}

/// <summary>Polls Google for changes (push channels need a public HTTPS endpoint, so polling is the dependable default).</summary>
public class GoogleSyncWorker(IServiceScopeFactory scopes, ILogger<GoogleSyncWorker> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<DaymakerDbContext>();
                var sync = scope.ServiceProvider.GetRequiredService<GoogleSyncService>();
                foreach (var userId in await db.GoogleConnections.Select(g => g.UserId).ToListAsync(ct))
                    await sync.SyncUser(userId);
            }
            catch (Exception ex) { log.LogError(ex, "Google sync worker failed"); }
        } while (await timer.WaitForNextTickAsync(ct));
    }
}
