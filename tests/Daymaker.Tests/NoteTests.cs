using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Daymaker.Tests;

public class NoteTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly JsonSerializerOptions J = ApiFixture.Json;

    [Fact]
    public async Task Todo_converts_to_note_with_link_checklist_and_attachments()
    {
        var c = await api.LoginAsync();
        var todo = await (await c.PostAsJsonAsync("/api/v1/todos", new
        {
            title = "Plan launch", description = "Line <b>one</b>", tags = new[] { "launch" },
            checklist = new[] { new { text = "Draft", done = true }, new { text = "Review", done = false } }
        }, J)).Content.ReadFromJsonAsync<JsonElement>(J);
        var todoId = todo.GetProperty("id").GetInt32();

        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes("hello"));
        file.Headers.ContentType = new("text/plain");
        form.Add(file, "file", "a.txt");
        Assert.True((await c.PostAsync($"/api/v1/attachments?owner=Todo&ownerId={todoId}", form)).IsSuccessStatusCode);

        var note = await (await c.PostAsync($"/api/v1/notes/from-todo/{todoId}", null)).Content.ReadFromJsonAsync<JsonElement>(J);
        Assert.Equal("Plan launch", note.GetProperty("title").GetString());
        Assert.Equal(todoId, note.GetProperty("sourceTodoId").GetInt32());
        Assert.Equal(1, note.GetProperty("attachmentCount").GetInt32());
        var html = note.GetProperty("contentHtml").GetString()!;
        Assert.Contains("data-checked=\"true\"", html);
        Assert.Contains("&lt;b&gt;one&lt;/b&gt;", html); // description is escaped, not injected
        Assert.Equal("launch", note.GetProperty("tags")[0].GetString());
    }

    [Fact]
    public async Task Notes_crud_pin_folder_and_checklist_to_todo()
    {
        var c = await api.LoginAsync();
        var folder = await (await c.PostAsJsonAsync("/api/v1/folders", new { name = "Ideas" })).Content.ReadFromJsonAsync<JsonElement>(J);
        var fid = folder.GetProperty("id").GetInt32();
        var note = await (await c.PostAsJsonAsync("/api/v1/notes", new { title = "Spec", contentHtml = "<p>alpha beta</p>", folderId = fid, tags = new[] { "dev" } }, J))
            .Content.ReadFromJsonAsync<JsonElement>(J);
        var id = note.GetProperty("id").GetInt32();

        await c.PostAsJsonAsync($"/api/v1/notes/{id}/pin", true);
        var pinned = await c.GetFromJsonAsync<JsonElement>("/api/v1/notes?pinned=true", J);
        Assert.Equal(1, pinned.GetArrayLength());
        Assert.Equal(1, (await c.GetFromJsonAsync<JsonElement>($"/api/v1/notes?q=beta&folderId={fid}", J)).GetArrayLength());

        var res = await (await c.PostAsJsonAsync($"/api/v1/notes/{id}/checklist-to-todo", new { text = "Write tests" }, J)).Content.ReadFromJsonAsync<JsonElement>(J);
        var todo = await c.GetFromJsonAsync<JsonElement>($"/api/v1/todos/{res.GetProperty("todoId").GetInt32()}", J);
        Assert.Equal("Write tests", todo.GetProperty("title").GetString());

        Assert.True((await c.DeleteAsync($"/api/v1/notes/{id}")).IsSuccessStatusCode);
        Assert.Equal(System.Net.HttpStatusCode.NotFound, (await c.GetAsync($"/api/v1/notes/{id}")).StatusCode);
    }
}
