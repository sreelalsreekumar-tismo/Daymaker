using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Xunit;

namespace Daymaker.Tests;

public class SearchTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private static readonly JsonSerializerOptions J = ApiFixture.Json;

    [Fact]
    public async Task Search_finds_todos_notes_and_attachment_names()
    {
        var c = await api.LoginAsync();
        var todo = await (await c.PostAsJsonAsync("/api/v1/todos", new { title = "Quarterly zebra report" }, J)).Content.ReadFromJsonAsync<JsonElement>(J);
        await c.PostAsJsonAsync("/api/v1/notes", new { title = "Zebra notes", contentHtml = "<p>stripes</p>" }, J);
        var form = new MultipartFormDataContent();
        var file = new ByteArrayContent(Encoding.UTF8.GetBytes("x")); file.Headers.ContentType = new("text/plain");
        form.Add(file, "file", "zebra-data.txt");
        await c.PostAsync($"/api/v1/attachments?owner=Todo&ownerId={todo.GetProperty("id").GetInt32()}", form);
        await c.PostAsJsonAsync("/api/v1/todos", new { title = "Unrelated" }, J);

        var hits = (await c.GetFromJsonAsync<JsonElement>("/api/v1/search?q=ZEBRA", J)).EnumerateArray().Select(h => h.GetProperty("kind").GetString()).ToList();
        Assert.Contains("todo", hits); Assert.Contains("note", hits); Assert.Contains("attachment", hits);
        Assert.DoesNotContain(hits, k => k == "event");

        var onlyNotes = (await c.GetFromJsonAsync<JsonElement>("/api/v1/search?q=zebra&kinds=note", J)).GetArrayLength();
        Assert.Equal(1, onlyNotes);
    }
}
