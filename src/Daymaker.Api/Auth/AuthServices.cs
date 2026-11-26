using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using Daymaker.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace Daymaker.Api.Auth;

public class JwtSettings
{
    public string Key { get; set; } = "";
    public string Issuer { get; set; } = "daymaker";
    public int ExpiryHours { get; set; } = 24 * 7;
}

public class JwtTokenService(IOptions<JwtSettings> opts)
{
    private readonly JwtSettings _s = opts.Value;

    public static SymmetricSecurityKey KeyFrom(string key) => new(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    public string Create(int userId, string email, string name)
    {
        var creds = new SigningCredentials(KeyFrom(_s.Key), SecurityAlgorithms.HmacSha256);
        var token = new JwtSecurityToken(
            _s.Issuer, _s.Issuer,
            [new Claim(ClaimTypes.NameIdentifier, userId.ToString()), new Claim(ClaimTypes.Email, email), new Claim(ClaimTypes.Name, name)],
            expires: DateTime.UtcNow.AddHours(_s.ExpiryHours), signingCredentials: creds);
        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}

/// <summary>The authenticated user plus the scopes granted (always full for JWT sessions).</summary>
public class CurrentUser(IHttpContextAccessor accessor)
{
    private ClaimsPrincipal P => accessor.HttpContext?.User ?? new ClaimsPrincipal();
    public int Id => int.Parse(P.FindFirstValue(ClaimTypes.NameIdentifier) ?? throw new UnauthorizedAccessException());
    public bool CanWrite => P.FindFirstValue("scope_write") != "false";
    public bool CanDelete => P.FindFirstValue("scope_delete") != "false";
}

public static class TokenHasher
{
    public static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(token)));
    public static string NewToken() => "dm_" + Convert.ToHexString(RandomNumberGenerator.GetBytes(24)).ToLowerInvariant();
}

/// <summary>Authenticates "Bearer dm_..." personal access tokens (used by the MCP server).</summary>
public class ApiTokenHandler(IOptionsMonitor<AuthenticationSchemeOptions> o, ILoggerFactory l, UrlEncoder e, DaymakerDbContext db)
    : AuthenticationHandler<AuthenticationSchemeOptions>(o, l, e)
{
    public new const string Scheme = "ApiToken";

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var header = Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer dm_")) return AuthenticateResult.NoResult();
        var hash = TokenHasher.Hash(header["Bearer ".Length..]);
        var token = await db.ApiTokens.FirstOrDefaultAsync(t => t.Hash == hash);
        if (token is null) return AuthenticateResult.Fail("Invalid token");
        token.LastUsedUtc = DateTime.UtcNow;
        await db.SaveChangesAsync();
        var identity = new ClaimsIdentity([
            new Claim(ClaimTypes.NameIdentifier, token.UserId.ToString()),
            new Claim("scope_write", token.CanWrite ? "true" : "false"),
            new Claim("scope_delete", token.CanDelete ? "true" : "false")], Scheme);
        return AuthenticateResult.Success(new AuthenticationTicket(new ClaimsPrincipal(identity), Scheme));
    }
}
