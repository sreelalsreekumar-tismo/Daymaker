using Daymaker.Core.Entities;
using Daymaker.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Services;

[Authorize]
public class NotificationHub : Hub
{
    public static string Group(int userId) => $"user-{userId}";

    public override async Task OnConnectedAsync()
    {
        var id = Context.User?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
        if (id is not null) await Groups.AddToGroupAsync(Context.ConnectionId, Group(int.Parse(id)));
        await base.OnConnectedAsync();
    }
}

public class NotificationService(DaymakerDbContext db, IHubContext<NotificationHub> hub)
{
    /// <summary>Stores a notification (if the user's preferences allow that type) and pushes it live over SignalR.</summary>
    public async Task<Notification?> Notify(int userId, NotificationType type, string title, string message, string? linkKind = null, int? linkId = null)
    {
        var p = await db.Preferences.AsNoTracking().FirstOrDefaultAsync(x => x.UserId == userId);
        if (p is not null && !Allowed(p, type)) return null;
        var n = new Notification { UserId = userId, Type = type, Title = title, Message = message, LinkKind = linkKind, LinkId = linkId };
        db.Notifications.Add(n);
        await db.SaveChangesAsync();
        await hub.Clients.Group(NotificationHub.Group(userId)).SendAsync("notification", Dto(n));
        return n;
    }

    public static object Dto(Notification n) => new { n.Id, Type = n.Type.ToString(), n.Title, n.Message, n.LinkKind, n.LinkId, n.Read, CreatedUtc = DateTime.SpecifyKind(n.CreatedUtc, DateTimeKind.Utc) };

    private static bool Allowed(UserPreferences p, NotificationType t) => t switch
    {
        NotificationType.DeadlineApproaching or NotificationType.Reminder => p.NotifyDeadlines,
        NotificationType.MeetingAdded or NotificationType.MeetingChanged => p.NotifyMeetings,
        NotificationType.TaskUpdated => p.NotifyTaskUpdates,
        NotificationType.DailySummary => p.NotifyDailySummary,
        _ => true,
    };
}

/// <summary>Raises deadline, reminder and daily-summary notifications.</summary>
public class NotificationWorker(IServiceScopeFactory scopes, ILogger<NotificationWorker> log) : BackgroundService
{
    public static readonly TimeSpan DeadlineWindow = TimeSpan.FromHours(1);
    public const int SummaryHourUtc = 8;

    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1));
        do
        {
            try { await RunOnce(DateTime.UtcNow, ct); }
            catch (Exception ex) { log.LogError(ex, "Notification worker failed"); }
        } while (await timer.WaitForNextTickAsync(ct));
    }

    public async Task RunOnce(DateTime now, CancellationToken ct = default)
    {
        using var scope = scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DaymakerDbContext>();
        var notifier = scope.ServiceProvider.GetRequiredService<NotificationService>();

        var open = db.Todos.Where(t => t.Status != TodoStatus.Completed);

        var due = await open.Where(t => !t.DeadlineNotified && t.DueUtc != null && t.DueUtc <= now + DeadlineWindow).ToListAsync(ct);
        foreach (var t in due)
        {
            t.DeadlineNotified = true;
            var overdue = t.DueUtc < now;
            await notifier.Notify(t.UserId, NotificationType.DeadlineApproaching, overdue ? "Task overdue" : "Deadline approaching",
                $"\"{t.Title}\" is {(overdue ? "overdue" : "due soon")}", "todo", t.Id);
        }

        var reminders = await open.Where(t => !t.ReminderSent && t.ReminderUtc != null && t.ReminderUtc <= now).ToListAsync(ct);
        foreach (var t in reminders)
        {
            t.ReminderSent = true;
            await notifier.Notify(t.UserId, NotificationType.Reminder, "Reminder", t.Title, "todo", t.Id);
        }
        await db.SaveChangesAsync(ct);

        if (now.Hour >= SummaryHourUtc)
        {
            var today = now.Date;
            var users = await db.Preferences.Where(p => p.NotifyDailySummary && (p.LastSummaryUtc == null || p.LastSummaryUtc < today)).ToListAsync(ct);
            foreach (var p in users)
            {
                p.LastSummaryUtc = now;
                var pending = await db.Todos.CountAsync(t => t.UserId == p.UserId && t.Status != TodoStatus.Completed, ct);
                var overdue = await db.Todos.CountAsync(t => t.UserId == p.UserId && t.Status != TodoStatus.Completed && t.DueUtc < now, ct);
                var meetings = await db.CalendarEvents.CountAsync(e => e.UserId == p.UserId && e.StartUtc >= today && e.StartUtc < today.AddDays(1), ct);
                await db.SaveChangesAsync(ct);
                await notifier.Notify(p.UserId, NotificationType.DailySummary, "Your day at a glance",
                    $"{pending} pending tasks ({overdue} overdue), {meetings} meetings today");
            }
        }
    }
}
