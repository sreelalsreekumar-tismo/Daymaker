using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Xunit;

namespace Daymaker.Tests;

public class TodoTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly System.Text.Json.JsonSerializerOptions J = ApiFixture.Json;

    [Fact]
    public async Task Unauthenticated_requests_are_rejected()
    {
        var res = await api.CreateClient().GetAsync("/api/v1/todos");
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public async Task Create_list_complete_delete_roundtrip()
    {
        var c = await api.LoginAsync();
        var created = await c.PostAsJsonAsync("/api/v1/todos", new { title = "Write docs", priority = "High", tags = new[] { "work" }, checklist = new[] { new { text = "outline", done = false } } }, J);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        var todo = await created.Content.ReadFromJsonAsync<JsonElement>(J);
        var id = todo.GetProperty("id").GetInt32();
        Assert.Equal("work", todo.GetProperty("tags")[0].GetString());

        var list = await c.GetFromJsonAsync<JsonElement>("/api/v1/todos?tag=work", J);
        Assert.Equal(1, list.GetArrayLength());

        Assert.Equal(HttpStatusCode.OK, (await c.PostAsync($"/api/v1/todos/{id}/complete", null)).StatusCode);
        var done = await c.GetFromJsonAsync<JsonElement>($"/api/v1/todos/{id}", J);
        Assert.Equal("Completed", done.GetProperty("status").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await c.DeleteAsync($"/api/v1/todos/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await c.GetAsync($"/api/v1/todos/{id}")).StatusCode);
    }

    [Fact]
    public async Task Recurring_todo_spawns_next_occurrence_on_completion()
    {
        var c = await api.LoginAsync();
        var due = DateTime.UtcNow.AddDays(1);
        var res = await c.PostAsJsonAsync("/api/v1/todos", new { title = "Standup notes", dueUtc = due, recurrence = "Weekly" }, J);
        var id = (await res.Content.ReadFromJsonAsync<JsonElement>(J)).GetProperty("id").GetInt32();
        var done = await (await c.PostAsync($"/api/v1/todos/{id}/complete", null)).Content.ReadFromJsonAsync<JsonElement>(J);
        var nextId = done.GetProperty("next").GetInt32();
        var next = await c.GetFromJsonAsync<JsonElement>($"/api/v1/todos/{nextId}", J);
        Assert.Equal("ToDo", next.GetProperty("status").GetString());
        Assert.True((next.GetProperty("dueUtc").GetDateTime() - due).TotalDays is > 6.9 and < 7.1);
    }

    [Fact]
    public async Task Token_without_delete_scope_cannot_delete()
    {
        var c = await api.LoginAsync();
        var tok = (await (await c.PostAsJsonAsync("/api/v1/auth/tokens", new { name = "t", canWrite = true, canDelete = false })).Content
            .ReadFromJsonAsync<JsonElement>()).GetProperty("token").GetString();
        var id = (await (await c.PostAsJsonAsync("/api/v1/todos", new { title = "keep me" }, J)).Content.ReadFromJsonAsync<JsonElement>(J)).GetProperty("id").GetInt32();

        var pat = api.CreateClient();
        pat.DefaultRequestHeaders.Authorization = new("Bearer", tok);
        Assert.Equal(HttpStatusCode.Forbidden, (await pat.DeleteAsync($"/api/v1/todos/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await pat.PostAsJsonAsync("/api/v1/todos", new { title = "ok" }, J)).StatusCode);
    }
}
