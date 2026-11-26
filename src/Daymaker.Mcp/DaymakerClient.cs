using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ModelContextProtocol;

namespace Daymaker.Mcp;

/// <summary>Thin REST client for the Daymaker API. Failures become McpExceptions whose message Claude can show the user.</summary>
public class DaymakerClient(HttpClient http)
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new System.Text.Json.Serialization.JsonStringEnumConverter() },
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull,
    };

    public Task<string> Get(string path) => Send(HttpMethod.Get, path, null);
    public Task<string> Post(string path, object? body = null) => Send(HttpMethod.Post, path, body);
    public Task<string> Put(string path, object? body) => Send(HttpMethod.Put, path, body);
    public Task<string> Delete(string path) => Send(HttpMethod.Delete, path, null);

    private async Task<string> Send(HttpMethod method, string path, object? body)
    {
        using var req = new HttpRequestMessage(method, path);
        if (body is not null) req.Content = JsonContent.Create(body, options: Json);
        HttpResponseMessage res;
        try { res = await http.SendAsync(req); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new McpException($"Could not reach the Daymaker API at {http.BaseAddress}. Is it running? ({ex.Message})");
        }
        using (res)
        {
            var text = await res.Content.ReadAsStringAsync();
            if (res.IsSuccessStatusCode) return string.IsNullOrWhiteSpace(text) ? "{\"ok\":true}" : text;
            throw new McpException(res.StatusCode switch
            {
                HttpStatusCode.Unauthorized => "Daymaker rejected the access token (invalid or revoked). Create a new one in Settings.",
                HttpStatusCode.NotFound => "Not found.",
                _ => $"Daymaker error {(int)res.StatusCode}: {Title(text) ?? res.ReasonPhrase}",
            });
        }
    }

    private static string? Title(string body)
    {
        try { return JsonDocument.Parse(body).RootElement.TryGetProperty("title", out var t) ? t.GetString() : null; }
        catch { return null; }
    }
}
