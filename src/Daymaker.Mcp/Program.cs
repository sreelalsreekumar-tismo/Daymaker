using Daymaker.Mcp;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

var builder = Host.CreateApplicationBuilder(args);

// stdout carries the MCP protocol, so all logging must go to stderr.
builder.Logging.AddConsole(o => o.LogToStandardErrorThreshold = LogLevel.Trace);

var apiUrl = Environment.GetEnvironmentVariable("DAYMAKER_API_URL") ?? "http://localhost:5146";
var token = Environment.GetEnvironmentVariable("DAYMAKER_TOKEN");
if (string.IsNullOrWhiteSpace(token) || !token.StartsWith("dm_"))
{
    Console.Error.WriteLine("DAYMAKER_TOKEN is not set. Create a personal access token in Daymaker (Settings > Claude access) and set DAYMAKER_TOKEN.");
    return 1;
}

builder.Services.AddHttpClient<DaymakerClient>(c =>
{
    c.BaseAddress = new Uri(apiUrl.TrimEnd('/') + "/");
    c.DefaultRequestHeaders.Authorization = new("Bearer", token);
    c.Timeout = TimeSpan.FromSeconds(30);
});

builder.Services.AddMcpServer().WithStdioServerTransport().WithToolsFromAssembly();

await builder.Build().RunAsync();
return 0;
