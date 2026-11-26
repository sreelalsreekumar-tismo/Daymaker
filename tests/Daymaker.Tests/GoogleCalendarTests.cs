using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Daymaker.Tests;

public class GoogleCalendarTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly JsonSerializerOptions J = ApiFixture.Json;

    private async Task<HttpClient> ConnectedClient()
    {
        var c = await api.LoginAsync();
        var url = (await c.GetFromJsonAsync<JsonElement>("/api/v1/google/connect-url")).GetProperty("url").GetString()!;
        var state = Uri.UnescapeDataString(url[(url.IndexOf("state=") + 6)..]);
        // The callback redirects the browser; don't follow it.
        var raw = api.CreateClient(new() { AllowAutoRedirect = false });
        var res = await raw.GetAsync($"/api/v1/google/callback?code=abc&state={Uri.EscapeDataString(state)}");
        Assert.Equal(HttpStatusCode.Redirect, res.StatusCode);
        Assert.Contains("google=connected", res.Headers.Location!.ToString());
        return c;
    }

    [Fact]
    public async Task Callback_with_forged_state_is_rejected()
    {
        var raw = api.CreateClient(new() { AllowAutoRedirect = false });
        var res = await raw.GetAsync("/api/v1/google/callback?code=abc&state=forged");
        Assert.Contains("google=error", res.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Connect_sync_imports_meetings_and_later_changes_notify()
    {
        api.Google.RemoteChange("m1", "Design review", DateTime.UtcNow.AddDays(1));
        var c = await ConnectedClient();

        var status = await c.GetFromJsonAsync<JsonElement>("/api/v1/google/status", J);
        Assert.True(status.GetProperty("connected").GetBoolean());
        Assert.Equal(JsonValueKind.String, status.GetProperty("lastSyncUtc").ValueKind);

        var events = await c.GetFromJsonAsync<JsonElement>($"/api/v1/calendar/events?from={DateTime.UtcNow:O}&to={DateTime.UtcNow.AddDays(7):O}", J);
        Assert.Contains(events.EnumerateArray(), e => e.GetProperty("title").GetString() == "Design review");
        // Initial import must not flood the notification center.
        Assert.Equal(0, (await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications", J)).GetProperty("items").GetArrayLength());

        api.Google.RemoteChange("m2", "Surprise meeting", DateTime.UtcNow.AddDays(2));
        var sync = await (await c.PostAsync("/api/v1/google/sync", null)).Content.ReadFromJsonAsync<JsonElement>(J);
        Assert.Equal(1, sync.GetProperty("added").GetInt32());
        var notes = (await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications", J)).GetProperty("items").EnumerateArray().ToList();
        Assert.Contains(notes, n => n.GetProperty("type").GetString() == "MeetingAdded");

        api.Google.RemoteChange("m2", "Surprise meeting", DateTime.UtcNow.AddDays(2), cancelled: true);
        await c.PostAsync("/api/v1/google/sync", null);
        var after = await c.GetFromJsonAsync<JsonElement>($"/api/v1/calendar/events?from={DateTime.UtcNow:O}&to={DateTime.UtcNow.AddDays(7):O}", J);
        Assert.DoesNotContain(after.EnumerateArray(), e => e.GetProperty("title").GetString() == "Surprise meeting");
    }

    [Fact]
    public async Task Todo_with_add_to_calendar_creates_event_and_syncs_both_ways()
    {
        var c = await ConnectedClient();
        var due = DateTime.UtcNow.AddDays(1).Date.AddHours(10);
        var todo = await (await c.PostAsJsonAsync("/api/v1/todos", new { title = "API docs", dueUtc = due, addToCalendar = true }, J)).Content.ReadFromJsonAsync<JsonElement>(J);
        var id = todo.GetProperty("id").GetInt32();
        var eventId = todo.GetProperty("googleEventId").GetString()!;
        Assert.Null(todo.GetProperty("syncError").GetString());
        Assert.Contains(api.Google.Remote, e => e.Id == eventId && e.Title == "API docs" && e.StartUtc == due);

        // our own push echoing back must not raise notifications or change anything
        await c.DeleteAsync("/api/v1/notifications");
        await c.PostAsync("/api/v1/google/sync", null);
        Assert.Equal(0, (await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications", J)).GetProperty("items").GetArrayLength());

        // edit in the app -> Google
        await c.PutAsJsonAsync($"/api/v1/todos/{id}", new { title = "API docs v2", dueUtc = due.AddHours(1) }, J);
        Assert.Contains(api.Google.Remote, e => e.Id == eventId && e.Title == "API docs v2");

        // edit in Google -> app
        api.Google.RemoteChange(eventId, "Docs moved", due.AddDays(1));
        await c.PostAsync("/api/v1/google/sync", null);
        var updated = await c.GetFromJsonAsync<JsonElement>($"/api/v1/todos/{id}", J);
        Assert.Equal("Docs moved", updated.GetProperty("title").GetString());
        Assert.Equal(due.AddDays(1), updated.GetProperty("dueUtc").GetDateTime());

        // deleting the todo removes the Google event
        await c.DeleteAsync($"/api/v1/todos/{id}");
        Assert.Contains(eventId, api.Google.Deleted);
    }

    [Fact]
    public async Task Calendar_failure_still_saves_todo_and_reports_error()
    {
        var c = await ConnectedClient();
        api.Google.FailWrites = true;
        try
        {
            var res = await c.PostAsJsonAsync("/api/v1/todos", new { title = "Offline", dueUtc = DateTime.UtcNow.AddDays(1), addToCalendar = true }, J);
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            var todo = await res.Content.ReadFromJsonAsync<JsonElement>(J);
            Assert.Contains("sync failed", todo.GetProperty("syncError").GetString());
            Assert.Equal(JsonValueKind.Null, todo.GetProperty("googleEventId").ValueKind);
        }
        finally { api.Google.FailWrites = false; }
    }

    [Fact]
    public async Task Add_to_calendar_without_connection_or_due_date_reports_why()
    {
        var c = await api.LoginAsync();
        var todo = await (await c.PostAsJsonAsync("/api/v1/todos", new { title = "x", dueUtc = DateTime.UtcNow.AddDays(1), addToCalendar = true }, J)).Content.ReadFromJsonAsync<JsonElement>(J);
        Assert.Contains("not connected", todo.GetProperty("syncError").GetString());
    }

    [Fact]
    public async Task Direct_event_crud_and_disconnect()
    {
        var c = await ConnectedClient();
        var start = DateTime.UtcNow.AddDays(3).Date.AddHours(10);
        var created = await (await c.PostAsJsonAsync("/api/v1/calendar/events", new { title = "Planning", startUtc = start, endUtc = start.AddHours(1) }, J)).Content.ReadFromJsonAsync<JsonElement>(J);
        var id = created.GetProperty("id").GetInt32();
        Assert.Contains(api.Google.Remote, e => e.Title == "Planning");

        Assert.Equal(HttpStatusCode.BadRequest, (await c.PostAsJsonAsync("/api/v1/calendar/events", new { title = "Bad", startUtc = start, endUtc = start.AddHours(-1) }, J)).StatusCode);

        await c.PutAsJsonAsync($"/api/v1/calendar/events/{id}", new { title = "Planning 2", startUtc = start, endUtc = start.AddHours(2) }, J);
        Assert.Contains(api.Google.Remote, e => e.Title == "Planning 2");

        Assert.Equal(HttpStatusCode.NoContent, (await c.PostAsync("/api/v1/google/disconnect", null)).StatusCode);
        Assert.True(api.Google.Revoked);
        Assert.False((await c.GetFromJsonAsync<JsonElement>("/api/v1/google/status", J)).GetProperty("connected").GetBoolean());
        Assert.Equal(0, (await c.GetFromJsonAsync<JsonElement>($"/api/v1/calendar/events?from={start.AddDays(-1):O}&to={start.AddDays(1):O}", J)).GetArrayLength());
    }
}
