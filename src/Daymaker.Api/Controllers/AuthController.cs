using Daymaker.Api.Auth;
using Daymaker.Core.Entities;
using Daymaker.Data;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace Daymaker.Api.Controllers;

public record GoogleLoginRequest(string IdToken);
public record CreateTokenRequest(string Name, bool CanWrite, bool CanDelete);

[ApiController]
[Route("api/v1/auth")]
public class AuthController(DaymakerDbContext db, JwtTokenService jwt, IConfiguration config, IWebHostEnvironment env, CurrentUser me) : ControllerBase
{
    [HttpGet("config")]
    public IActionResult GetConfig() => Ok(new { googleClientId = config["Google:ClientId"], devLogin = env.IsDevelopment() });

    [HttpPost("google")]
    public async Task<IActionResult> Google(GoogleLoginRequest req)
    {
        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(req.IdToken,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [config["Google:ClientId"]] });
        }
        catch (InvalidJwtException)
        {
            return Unauthorized(new ProblemDetails { Title = "Invalid Google token" });
        }
        return Ok(await SignIn(payload.Subject, payload.Email, payload.Name ?? payload.Email, payload.Picture));
    }

    /// <summary>Development-only login so the app can be used without Google credentials.</summary>
    [HttpPost("dev")]
    public async Task<IActionResult> Dev([FromQuery] string? user = null)
    {
        if (!env.IsDevelopment()) return NotFound();
        var key = string.IsNullOrWhiteSpace(user) ? "user" : new string(user.Where(char.IsLetterOrDigit).Take(40).ToArray());
        return Ok(await SignIn("dev-" + key, $"{key}@daymaker.local", key == "user" ? "Dev User" : "Dev " + key, null));
    }

    private async Task<object> SignIn(string subject, string email, string name, string? picture)
    {
        var user = await db.Users.Include(u => u.Preferences).FirstOrDefaultAsync(u => u.GoogleSubject == subject);
        if (user is null)
        {
            user = new User { GoogleSubject = subject, Email = email, Name = name, PictureUrl = picture };
            db.Users.Add(user);
        }
        else { user.Name = name; user.PictureUrl = picture; }
        await db.SaveChangesAsync();
        return new { token = jwt.Create(user.Id, user.Email, user.Name), user = new { user.Id, user.Email, user.Name, user.PictureUrl } };
    }

    [Authorize, HttpGet("me")]
    public async Task<IActionResult> Me()
    {
        var u = await db.Users.AsNoTracking().FirstAsync(x => x.Id == me.Id);
        return Ok(new { u.Id, u.Email, u.Name, u.PictureUrl });
    }

    // ---- Personal access tokens (for the MCP server) ----
    [Authorize, HttpGet("tokens")]
    public async Task<IActionResult> Tokens() =>
        Ok(await db.ApiTokens.Where(t => t.UserId == me.Id)
            .Select(t => new { t.Id, t.Name, t.CanWrite, t.CanDelete, t.CreatedUtc, t.LastUsedUtc }).ToListAsync());

    [Authorize, HttpPost("tokens")]
    public async Task<IActionResult> CreateToken(CreateTokenRequest req)
    {
        var raw = TokenHasher.NewToken();
        db.ApiTokens.Add(new ApiToken { UserId = me.Id, Name = req.Name, Hash = TokenHasher.Hash(raw), CanWrite = req.CanWrite, CanDelete = req.CanDelete });
        await db.SaveChangesAsync();
        return Ok(new { token = raw }); // shown once
    }

    [Authorize, HttpDelete("tokens/{id:int}")]
    public async Task<IActionResult> DeleteToken(int id)
    {
        await db.ApiTokens.Where(t => t.Id == id && t.UserId == me.Id).ExecuteDeleteAsync();
        return NoContent();
    }
}
