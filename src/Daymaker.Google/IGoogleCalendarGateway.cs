namespace Daymaker.Google;

public record GCalendar(string Id, string Name, bool Primary);

public record GEvent(string Id, string CalendarId, string Title, string Description, string? Location,
    DateTime StartUtc, DateTime EndUtc, bool AllDay, string? ETag, bool Cancelled);

public record GEventInput(string Title, string Description, DateTime StartUtc, DateTime EndUtc, bool AllDay, int? ReminderMinutes);

/// <summary>Events changed since the previous sync token. FullSync means the token was missing/expired so Events is the full window.</summary>
public record GChanges(List<GEvent> Events, string? NextSyncToken, bool FullSync);

/// <summary>All Google Calendar access goes through here so sync logic can be tested without Google.</summary>
public interface IGoogleCalendarGateway
{
    bool IsConfigured { get; }
    string BuildAuthUrl(string state, string redirectUri);
    Task<string> ExchangeCodeForRefreshToken(string code, string redirectUri);
    Task<List<GCalendar>> ListCalendars(string refreshToken);
    Task<GChanges> ListChanges(string refreshToken, string calendarId, string? syncToken, DateTime timeMinUtc, DateTime timeMaxUtc);
    Task<GEvent> Insert(string refreshToken, string calendarId, GEventInput e);
    Task<GEvent> Update(string refreshToken, string calendarId, string eventId, GEventInput e);
    Task Delete(string refreshToken, string calendarId, string eventId);
    Task Revoke(string refreshToken);
}
