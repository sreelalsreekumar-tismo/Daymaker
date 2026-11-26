using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Daymaker.Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Daymaker.Tests;

public class NotificationTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly JsonSerializerOptions J = ApiFixture.Json;

    [Fact]
    public async Task Change_via_api_token_creates_unread_notification_that_can_be_read_and_cleared()
    {
        var c = await api.LoginAsync();
        var tok = (await (await c.PostAsJsonAsync("/api/v1/auth/tokens", new { name = "claude", canWrite = true, canDelete = false })).Content
            .ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        var pat = api.CreateClient();
        pat.DefaultRequestHeaders.Authorization = new("Bearer", tok);
        await pat.PostAsJsonAsync("/api/v1/todos", new { title = "From Claude" }, J);

        var list = await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications?unreadOnly=true", J);
        Assert.True(list.GetProperty("unread").GetInt32() >= 1);
        var first = list.GetProperty("items")[0];
        Assert.Equal("todo", first.GetProperty("linkKind").GetString());

        await c.PostAsync("/api/v1/notifications/read-all", null);
        Assert.Equal(0, (await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications", J)).GetProperty("unread").GetInt32());
        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync("/api/v1/notifications")).StatusCode);
        Assert.Equal(0, (await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications", J)).GetProperty("items").GetArrayLength());
    }

    [Fact]
    public async Task Worker_flags_overdue_tasks_once_and_sends_daily_summary()
    {
        var c = await api.LoginAsync();
        await c.PostAsJsonAsync("/api/v1/todos", new { title = "Late one", dueUtc = DateTime.UtcNow.AddHours(-3) }, J);
        var worker = api.Services.GetRequiredService<NotificationWorker>();

        await worker.RunOnce(DateTime.UtcNow.Date.AddHours(10));
        await worker.RunOnce(DateTime.UtcNow.Date.AddHours(10)); // second run must not duplicate

        var items = (await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications", J)).GetProperty("items").EnumerateArray().ToList();
        Assert.Single(items, i => i.GetProperty("type").GetString() == "DeadlineApproaching");
        Assert.Single(items, i => i.GetProperty("type").GetString() == "DailySummary");
    }

    [Fact]
    public async Task Disabled_notification_type_is_not_created()
    {
        var c = await api.LoginAsync();
        var prefs = await c.GetFromJsonAsync<JsonElement>("/api/v1/preferences", J);
        var body = JsonSerializer.Deserialize<Dictionary<string, object>>(prefs.GetRawText(), J)!;
        body["notifyTaskUpdates"] = false;
        Assert.Equal(HttpStatusCode.OK, (await c.PutAsJsonAsync("/api/v1/preferences", body, J)).StatusCode);

        var tok = (await (await c.PostAsJsonAsync("/api/v1/auth/tokens", new { name = "x", canWrite = true, canDelete = false })).Content
            .ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        var pat = api.CreateClient();
        pat.DefaultRequestHeaders.Authorization = new("Bearer", tok);
        await c.DeleteAsync("/api/v1/notifications");
        await pat.PostAsJsonAsync("/api/v1/todos", new { title = "silent" }, J);
        Assert.Equal(0, (await c.GetFromJsonAsync<JsonElement>("/api/v1/notifications", J)).GetProperty("items").GetArrayLength());
    }
}
