using System.ComponentModel;
using System.Globalization;
using ModelContextProtocol;
using ModelContextProtocol.Server;

namespace Daymaker.Mcp;

[McpServerToolType]
public static class DaymakerTools
{
    private const string TimeHelp = "ISO 8601 date-time. Include a UTC offset (e.g. 2026-11-27T10:00:00+05:30); without one it is read in the server machine's local time zone.";
    private const string ConfirmHelp = "Must be true. Ask the user to confirm the deletion first, and only then call again with confirm=true.";

    /// <summary>Parses user/Claude-supplied times. Offset-less values are local time of the machine running the MCP server.</summary>
    public static DateTime? ParseTime(string? s, string field)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        if (DateTimeOffset.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var d)) return d.UtcDateTime;
        throw new McpException($"'{field}' is not a valid date-time: '{s}'. Use ISO 8601, e.g. 2026-11-27T10:00:00+05:30.");
    }

    private static string? NeedConfirm(bool confirm, string what) =>
        confirm ? null : $"NOT DELETED. This is destructive: ask the user to confirm deleting {what}, then call again with confirm=true.";

    // ---------- time ----------
    [McpServerTool(Name = "current_time", ReadOnly = true), Description("Current local date, time, weekday and UTC offset of the user's machine. Call this before resolving relative dates like 'tomorrow' or 'Friday'.")]
    public static string CurrentTime() => DateTimeOffset.Now.ToString("dddd, yyyy-MM-dd HH:mm:ss zzz", CultureInfo.InvariantCulture);

    // ---------- todos ----------
    [McpServerTool(Name = "list_todos", ReadOnly = true), Description("List todos, newest priority first. All filters optional. Returns JSON.")]
    public static Task<string> ListTodos(DaymakerClient api,
        [Description("ToDo, InProgress or Completed")] string? status = null,
        [Description("Low, Medium, High or Urgent")] string? priority = null,
        [Description("Only open tasks past their due date")] bool? overdue = null,
        [Description("Filter by tag name")] string? tag = null,
        [Description("Text in title/description")] string? query = null)
    {
        var qs = new List<string>();
        void Add(string k, string? v) { if (!string.IsNullOrWhiteSpace(v)) qs.Add($"{k}={Uri.EscapeDataString(v)}"); }
        Add("status", status); Add("priority", priority); Add("tag", tag); Add("q", query);
        if (overdue == true) qs.Add("overdue=true");
        return api.Get("api/v1/todos" + (qs.Count > 0 ? "?" + string.Join('&', qs) : ""));
    }

    [McpServerTool(Name = "get_todo", ReadOnly = true), Description("Get one todo by id, including checklist and tags.")]
    public static Task<string> GetTodo(DaymakerClient api, int id) => api.Get($"api/v1/todos/{id}");

    [McpServerTool(Name = "create_todo"), Description("Create a todo. Set addToCalendar (needs dueDate) to also create a Google Calendar event for it.")]
    public static Task<string> CreateTodo(DaymakerClient api,
        [Description("Short task title")] string title,
        string? description = null,
        [Description(TimeHelp)] string? dueDate = null,
        [Description("Low, Medium, High or Urgent")] string? priority = null,
        [Description("Tag names")] string[]? tags = null,
        [Description("Checklist item texts")] string[]? checklist = null,
        [Description("Daily, Weekly or Monthly")] string? recurrence = null,
        [Description("Also create a Google Calendar event (requires dueDate and a connected Google account)")] bool addToCalendar = false)
        => api.Post("api/v1/todos", new
        {
            title, description, dueUtc = ParseTime(dueDate, nameof(dueDate)), priority, recurrence,
            tags, checklist = checklist?.Select(c => new { text = c, done = false }).ToArray(), addToCalendar,
        });

    [McpServerTool(Name = "update_todo", Idempotent = true), Description("Update a todo. Only the fields you pass are changed.")]
    public static async Task<string> UpdateTodo(DaymakerClient api, int id,
        string? title = null, string? description = null,
        [Description(TimeHelp)] string? dueDate = null,
        [Description("Low, Medium, High or Urgent")] string? priority = null,
        [Description("ToDo, InProgress or Completed")] string? status = null,
        string[]? tags = null)
    {
        // The API takes a full replacement, so merge onto the current todo.
        var cur = System.Text.Json.JsonDocument.Parse(await api.Get($"api/v1/todos/{id}")).RootElement;
        string Cur(string n) => cur.GetProperty(n).GetString() ?? "";
        return await api.Put($"api/v1/todos/{id}", new
        {
            title = title ?? Cur("title"),
            description = description ?? Cur("description"),
            dueUtc = dueDate is null ? (cur.GetProperty("dueUtc").ValueKind == System.Text.Json.JsonValueKind.Null ? (DateTime?)null : cur.GetProperty("dueUtc").GetDateTime()) : ParseTime(dueDate, nameof(dueDate)),
            priority = priority ?? Cur("priority"),
            status = status ?? Cur("status"),
            categoryId = cur.GetProperty("categoryId").ValueKind == System.Text.Json.JsonValueKind.Null ? (int?)null : cur.GetProperty("categoryId").GetInt32(),
            tags,
        });
    }

    [McpServerTool(Name = "complete_todo", Idempotent = true), Description("Mark a todo completed (recurring todos spawn their next occurrence).")]
    public static Task<string> CompleteTodo(DaymakerClient api, int id) => api.Post($"api/v1/todos/{id}/complete");

    [McpServerTool(Name = "delete_todo", Destructive = true), Description("Permanently delete a todo (and its Google Calendar event, if any). Requires a token with delete permission.")]
    public static async Task<string> DeleteTodo(DaymakerClient api, int id, [Description(ConfirmHelp)] bool confirm = false)
    {
        if (NeedConfirm(confirm, $"todo #{id}") is { } msg) return msg;
        await api.Delete($"api/v1/todos/{id}");
        return $"Deleted todo #{id}.";
    }

    [McpServerTool(Name = "save_todo_as_note"), Description("Create a note from a todo (title, description, checklist, attachments), linked back to the task.")]
    public static Task<string> SaveTodoAsNote(DaymakerClient api, int todoId) => api.Post($"api/v1/notes/from-todo/{todoId}");

    // ---------- notes ----------
    [McpServerTool(Name = "create_note"), Description("Create a note. Content is HTML (p, h1-h3, ul/ol/li, strong, em, a). For checklists use <ul data-type=\"taskList\"><li data-type=\"taskItem\" data-checked=\"false\"><p>item</p></li></ul>.")]
    public static Task<string> CreateNote(DaymakerClient api, string title, [Description("HTML content")] string? content = null,
        string[]? tags = null, bool pinned = false)
        => api.Post("api/v1/notes", new { title, contentHtml = content, tags, pinned });

    [McpServerTool(Name = "search_notes", ReadOnly = true), Description("Search notes by text in title or content. Omit the query to list recent notes.")]
    public static Task<string> SearchNotes(DaymakerClient api, string? query = null, string? tag = null)
        => api.Get($"api/v1/notes?q={Uri.EscapeDataString(query ?? "")}&tag={Uri.EscapeDataString(tag ?? "")}");

    [McpServerTool(Name = "get_note", ReadOnly = true), Description("Get one note by id.")]
    public static Task<string> GetNote(DaymakerClient api, int id) => api.Get($"api/v1/notes/{id}");

    [McpServerTool(Name = "delete_note", Destructive = true), Description("Permanently delete a note. Requires a token with delete permission.")]
    public static async Task<string> DeleteNote(DaymakerClient api, int id, [Description(ConfirmHelp)] bool confirm = false)
    {
        if (NeedConfirm(confirm, $"note #{id}") is { } msg) return msg;
        await api.Delete($"api/v1/notes/{id}");
        return $"Deleted note #{id}.";
    }

    // ---------- search ----------
    [McpServerTool(Name = "search", ReadOnly = true), Description("Search across todos, notes, meetings and attachment names at once.")]
    public static Task<string> Search(DaymakerClient api, string query,
        [Description("Comma list of: todo,note,event,attachment (default all)")] string? kinds = null)
        => api.Get($"api/v1/search?q={Uri.EscapeDataString(query)}" + (kinds is null ? "" : $"&kinds={Uri.EscapeDataString(kinds)}"));

    // ---------- calendar ----------
    [McpServerTool(Name = "list_upcoming_meetings", ReadOnly = true), Description("List calendar events (from Google Calendar) in the next N days.")]
    public static Task<string> UpcomingMeetings(DaymakerClient api, [Description("Days ahead, default 7")] int days = 7)
        => api.Get($"api/v1/calendar/events?from={Uri.EscapeDataString(DateTime.UtcNow.ToString("O"))}&to={Uri.EscapeDataString(DateTime.UtcNow.AddDays(Math.Clamp(days, 1, 90)).ToString("O"))}");

    [McpServerTool(Name = "create_calendar_event"), Description("Create an event in the user's Google Calendar. Requires a connected Google account.")]
    public static Task<string> CreateEvent(DaymakerClient api, string title,
        [Description(TimeHelp)] string start, [Description(TimeHelp + " Defaults to one hour after start.")] string? end = null,
        string? description = null, [Description("Popup reminder, minutes before")] int? reminderMinutes = null)
    {
        var s = ParseTime(start, nameof(start)) ?? throw new McpException("'start' is required.");
        return api.Post("api/v1/calendar/events", new { title, description, startUtc = s, endUtc = ParseTime(end, nameof(end)) ?? s.AddHours(1), reminderMinutes });
    }

    [McpServerTool(Name = "update_calendar_event", Idempotent = true), Description("Change an event's title, time or description. Use the id from list_upcoming_meetings.")]
    public static async Task<string> UpdateEvent(DaymakerClient api, int id, string? title = null,
        [Description(TimeHelp)] string? start = null, [Description(TimeHelp)] string? end = null, string? description = null)
    {
        var all = System.Text.Json.JsonDocument.Parse(await api.Get($"api/v1/calendar/events?from=2000-01-01&to=2100-01-01")).RootElement;
        var cur = all.EnumerateArray().FirstOrDefault(e => e.GetProperty("id").GetInt32() == id);
        if (cur.ValueKind == System.Text.Json.JsonValueKind.Undefined) throw new McpException($"Event #{id} not found.");
        var s = ParseTime(start, nameof(start)) ?? cur.GetProperty("startUtc").GetDateTime();
        var e2 = ParseTime(end, nameof(end)) ?? (start is not null ? s.Add(cur.GetProperty("endUtc").GetDateTime() - cur.GetProperty("startUtc").GetDateTime()) : cur.GetProperty("endUtc").GetDateTime());
        return await api.Put($"api/v1/calendar/events/{id}", new
        {
            title = title ?? cur.GetProperty("title").GetString(), description = description ?? cur.GetProperty("description").GetString(),
            startUtc = s, endUtc = e2, allDay = cur.GetProperty("allDay").GetBoolean(),
        });
    }

    [McpServerTool(Name = "delete_calendar_event", Destructive = true), Description("Delete an event from Google Calendar. Requires a token with delete permission.")]
    public static async Task<string> DeleteEvent(DaymakerClient api, int id, [Description(ConfirmHelp)] bool confirm = false)
    {
        if (NeedConfirm(confirm, $"calendar event #{id}") is { } msg) return msg;
        await api.Delete($"api/v1/calendar/events/{id}");
        return $"Deleted calendar event #{id}.";
    }
}
