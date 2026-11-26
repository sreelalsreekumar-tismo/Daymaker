using Daymaker.Api.Auth;
using Daymaker.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddControllers().AddJsonOptions(o =>
    o.JsonSerializerOptions.Converters.Add(new System.Text.Json.Serialization.JsonStringEnumConverter()));
builder.Services.AddProblemDetails();
builder.Services.AddHttpContextAccessor();

builder.Services.AddDbContext<DaymakerDbContext>(o =>
    o.UseSqlite(builder.Configuration.GetConnectionString("Default") ?? "Data Source=daymaker.db"));

builder.Services.Configure<JwtSettings>(builder.Configuration.GetSection("Jwt"));
var jwt = builder.Configuration.GetSection("Jwt").Get<JwtSettings>() ?? new JwtSettings();
if (string.IsNullOrWhiteSpace(jwt.Key))
{
    if (!builder.Environment.IsDevelopment()) throw new InvalidOperationException("Jwt:Key must be configured.");
    jwt.Key = "dev-only-signing-key-change-me";
    builder.Services.Configure<JwtSettings>(o => o.Key = jwt.Key);
}

builder.Services.AddSingleton<JwtTokenService>();
builder.Services.AddScoped<CurrentUser>();
builder.Services.AddScoped<Daymaker.Api.Services.TodoService>();
builder.Services.AddScoped<Daymaker.Api.Services.NotificationService>();
builder.Services.AddSignalR();
builder.Services.AddSingleton<Daymaker.Api.Services.NotificationWorker>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<Daymaker.Api.Services.NotificationWorker>());

builder.Services.AddAuthentication(o =>
    {
        o.DefaultScheme = "Smart";
        o.DefaultChallengeScheme = "Smart";
    })
    .AddPolicyScheme("Smart", null, o => o.ForwardDefaultSelector = ctx =>
        ctx.Request.Headers.Authorization.ToString().StartsWith("Bearer dm_")
            ? ApiTokenHandler.Scheme
            : JwtBearerDefaults.AuthenticationScheme)
    .AddScheme<AuthenticationSchemeOptions, ApiTokenHandler>(ApiTokenHandler.Scheme, null)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = new TokenValidationParameters
        {
            ValidIssuer = jwt.Issuer, ValidAudience = jwt.Issuer,
            IssuerSigningKey = JwtTokenService.KeyFrom(jwt.Key),
            ValidateIssuerSigningKey = true,
        };
        // SignalR sends the token in the query string for WebSockets.
        o.Events = new JwtBearerEvents
        {
            OnMessageReceived = ctx =>
            {
                var token = ctx.Request.Query["access_token"];
                if (!string.IsNullOrEmpty(token) && ctx.HttpContext.Request.Path.StartsWithSegments("/hubs"))
                    ctx.Token = token;
                return Task.CompletedTask;
            }
        };
    });
builder.Services.AddAuthorization();

builder.Services.AddCors(o => o.AddDefaultPolicy(p => p
    .WithOrigins(builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? ["http://localhost:4200"])
    .AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

var app = builder.Build();

using (var scope = app.Services.CreateScope())
    scope.ServiceProvider.GetRequiredService<DaymakerDbContext>().Database.Migrate();

app.UseExceptionHandler();
app.UseStatusCodePages();
app.UseCors();
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<Daymaker.Api.Services.NotificationHub>("/hubs/notifications");

app.Run();

public partial class Program { }
