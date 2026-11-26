using Daymaker.Google;

namespace Daymaker.Tests;

/// <summary>In-memory stand-in for Google Calendar. Tests mutate <see cref="Remote"/> to simulate changes made in Google.</summary>
public class FakeGateway : IGoogleCalendarGateway
{
    private int _n, _version;
    public List<GEvent> Remote { get; } = new();
    public HashSet<string> Deleted { get; } = new();
    public bool Revoked { get; private set; }
    public bool FailWrites { get; set; }
    public bool IsConfigured => true;

    public string BuildAuthUrl(string state, string redirectUri) => $"https://accounts.example/auth?state={Uri.EscapeDataString(state)}";
    public Task<string> ExchangeCodeForRefreshToken(string code, string redirectUri) => Task.FromResult("refresh-" + code);
    public Task<List<GCalendar>> ListCalendars(string refreshToken) => Task.FromResult(new List<GCalendar> { new("primary", "Me", true), new("work@x", "Work", false) });

    public Task<GChanges> ListChanges(string refreshToken, string calendarId, string? syncToken, DateTime min, DateTime max)
    {
        var since = syncToken is null ? -1 : int.Parse(syncToken);
        var changed = Remote.Where(e => e.CalendarId == calendarId && VersionOf(e) > since).ToList();
        return Task.FromResult(new GChanges(changed, _version.ToString(), syncToken is null));
    }

    private readonly Dictionary<string, int> _versions = new();
    private int VersionOf(GEvent e) => _versions.GetValueOrDefault(e.Id);
    private void Put(GEvent e)
    {
        Remote.RemoveAll(x => x.Id == e.Id);
        Remote.Add(e);
        _versions[e.Id] = ++_version;
    }

    /// <summary>Simulates an edit/create/cancel made directly in Google Calendar.</summary>
    public GEvent RemoteChange(string id, string title, DateTime start, string calendar = "primary", bool cancelled = false)
    {
        var e = new GEvent(id, calendar, title, "", null, start, start.AddHours(1), false, "etag-" + (_version + 1), cancelled);
        Put(e);
        return e;
    }

    public Task<GEvent> Insert(string refreshToken, string calendarId, GEventInput i)
    {
        if (FailWrites) throw new HttpRequestException("Google is unavailable");
        var e = new GEvent("ev" + (++_n), calendarId, i.Title, i.Description, null, i.StartUtc, i.EndUtc, i.AllDay, "etag-" + (_version + 1), false);
        Put(e);
        return Task.FromResult(e);
    }

    public Task<GEvent> Update(string refreshToken, string calendarId, string eventId, GEventInput i)
    {
        if (FailWrites) throw new HttpRequestException("Google is unavailable");
        var e = new GEvent(eventId, calendarId, i.Title, i.Description, null, i.StartUtc, i.EndUtc, i.AllDay, "etag-" + (_version + 1), false);
        Put(e);
        return Task.FromResult(e);
    }

    public Task Delete(string refreshToken, string calendarId, string eventId)
    {
        Deleted.Add(eventId);
        Remote.RemoveAll(x => x.Id == eventId);
        return Task.CompletedTask;
    }

    public Task Revoke(string refreshToken) { Revoked = true; return Task.CompletedTask; }
}
