using System.Globalization;
using System.Net;
using Google;
using Google.Apis.Auth.OAuth2;
using Google.Apis.Auth.OAuth2.Flows;
using Google.Apis.Auth.OAuth2.Requests;
using Google.Apis.Auth.OAuth2.Responses;
using Google.Apis.Calendar.v3;
using Google.Apis.Calendar.v3.Data;
using Google.Apis.Services;

namespace Daymaker.Google;

public class GoogleOptions
{
    public string ClientId { get; set; } = "";
    public string ClientSecret { get; set; } = "";
    public string? RedirectUri { get; set; }
}

public class GoogleCalendarGateway(GoogleOptions options) : IGoogleCalendarGateway
{
    public bool IsConfigured => !string.IsNullOrWhiteSpace(options.ClientId) && !string.IsNullOrWhiteSpace(options.ClientSecret);

    private GoogleAuthorizationCodeFlow Flow() => new(new GoogleAuthorizationCodeFlow.Initializer
    {
        ClientSecrets = new ClientSecrets { ClientId = options.ClientId, ClientSecret = options.ClientSecret },
        Scopes = [CalendarService.Scope.Calendar],
    });

    private CalendarService Service(string refreshToken) => new(new BaseClientService.Initializer
    {
        HttpClientInitializer = new UserCredential(Flow(), "user", new TokenResponse { RefreshToken = refreshToken }),
        ApplicationName = "Daymaker",
    });

    public string BuildAuthUrl(string state, string redirectUri)
    {
        var req = (GoogleAuthorizationCodeRequestUrl)Flow().CreateAuthorizationCodeRequest(redirectUri);
        req.State = state;
        req.AccessType = "offline";
        req.Prompt = "consent"; // always return a refresh token, also on reconnect
        return req.Build().AbsoluteUri;
    }

    public async Task<string> ExchangeCodeForRefreshToken(string code, string redirectUri)
    {
        var token = await Flow().ExchangeCodeForTokenAsync("user", code, redirectUri, CancellationToken.None);
        return token.RefreshToken ?? throw new InvalidOperationException("Google did not return a refresh token. Remove Daymaker's access in your Google account and reconnect.");
    }

    public async Task<List<GCalendar>> ListCalendars(string refreshToken)
    {
        using var svc = Service(refreshToken);
        var list = await svc.CalendarList.List().ExecuteAsync();
        return list.Items.Select(c => new GCalendar(c.Id, c.SummaryOverride ?? c.Summary, c.Primary == true)).ToList();
    }

    public async Task<GChanges> ListChanges(string refreshToken, string calendarId, string? syncToken, DateTime timeMinUtc, DateTime timeMaxUtc)
    {
        using var svc = Service(refreshToken);
        try { return await Fetch(svc, calendarId, syncToken, timeMinUtc, timeMaxUtc); }
        catch (GoogleApiException ex) when (ex.HttpStatusCode == HttpStatusCode.Gone && syncToken is not null)
        {
            // Sync token expired: Google requires a full re-sync.
            return await Fetch(svc, calendarId, null, timeMinUtc, timeMaxUtc);
        }
    }

    private static async Task<GChanges> Fetch(CalendarService svc, string calendarId, string? syncToken, DateTime min, DateTime max)
    {
        var events = new List<GEvent>();
        string? page = null, next = null;
        do
        {
            var req = svc.Events.List(calendarId);
            req.SingleEvents = true;
            req.ShowDeleted = true;
            req.MaxResults = 250;
            req.PageToken = page;
            if (syncToken is not null) req.SyncToken = syncToken;
            else { req.TimeMinDateTimeOffset = new DateTimeOffset(min, TimeSpan.Zero); req.TimeMaxDateTimeOffset = new DateTimeOffset(max, TimeSpan.Zero); }
            var res = await req.ExecuteAsync();
            events.AddRange(res.Items.Select(e => Map(calendarId, e)));
            page = res.NextPageToken;
            next = res.NextSyncToken ?? next;
        } while (page is not null);
        return new GChanges(events, next, syncToken is null);
    }

    private static GEvent Map(string calendarId, Event e)
    {
        var allDay = e.Start?.Date is not null;
        DateTime start = DateTime.UtcNow, end = DateTime.UtcNow;
        if (e.Status != "cancelled" && e.Start is not null && e.End is not null)
        {
            start = allDay ? DateTime.SpecifyKind(DateTime.ParseExact(e.Start.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture), DateTimeKind.Utc)
                           : e.Start.DateTimeDateTimeOffset!.Value.UtcDateTime;
            end = allDay ? DateTime.SpecifyKind(DateTime.ParseExact(e.End.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture), DateTimeKind.Utc)
                         : e.End.DateTimeDateTimeOffset!.Value.UtcDateTime;
        }
        return new GEvent(e.Id, calendarId, e.Summary ?? "(no title)", e.Description ?? "", e.Location, start, end, allDay, e.ETag, e.Status == "cancelled");
    }

    private static Event ToEvent(GEventInput i)
    {
        var ev = new Event { Summary = i.Title, Description = i.Description };
        if (i.AllDay)
        {
            ev.Start = new EventDateTime { Date = i.StartUtc.ToString("yyyy-MM-dd") };
            ev.End = new EventDateTime { Date = (i.EndUtc > i.StartUtc ? i.EndUtc : i.StartUtc.AddDays(1)).ToString("yyyy-MM-dd") };
        }
        else
        {
            ev.Start = new EventDateTime { DateTimeDateTimeOffset = new DateTimeOffset(DateTime.SpecifyKind(i.StartUtc, DateTimeKind.Utc)) };
            ev.End = new EventDateTime { DateTimeDateTimeOffset = new DateTimeOffset(DateTime.SpecifyKind(i.EndUtc, DateTimeKind.Utc)) };
        }
        ev.Reminders = i.ReminderMinutes is { } m
            ? new Event.RemindersData { UseDefault = false, Overrides = [new EventReminder { Method = "popup", Minutes = m }] }
            : new Event.RemindersData { UseDefault = true };
        return ev;
    }

    public async Task<GEvent> Insert(string refreshToken, string calendarId, GEventInput e)
    {
        using var svc = Service(refreshToken);
        return Map(calendarId, await svc.Events.Insert(ToEvent(e), calendarId).ExecuteAsync());
    }

    public async Task<GEvent> Update(string refreshToken, string calendarId, string eventId, GEventInput e)
    {
        using var svc = Service(refreshToken);
        return Map(calendarId, await svc.Events.Patch(ToEvent(e), calendarId, eventId).ExecuteAsync());
    }

    public async Task Delete(string refreshToken, string calendarId, string eventId)
    {
        using var svc = Service(refreshToken);
        try { await svc.Events.Delete(calendarId, eventId).ExecuteAsync(); }
        catch (GoogleApiException ex) when (ex.HttpStatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone) { /* already gone */ }
    }

    public async Task Revoke(string refreshToken)
    {
        try { await Flow().RevokeTokenAsync("user", refreshToken, CancellationToken.None); }
        catch { /* best effort: the user may already have revoked access in Google */ }
    }
}
