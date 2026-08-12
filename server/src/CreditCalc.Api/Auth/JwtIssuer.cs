using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using CreditCalc.Api.Data;
using Microsoft.IdentityModel.Tokens;

namespace CreditCalc.Api.Auth;

/// <summary>Выпускает JWT для аутентифицированного пользователя и читает его id обратно из claims.</summary>
public class JwtIssuer
{
    private readonly IConfiguration _config;

    public JwtIssuer(IConfiguration config)
    {
        _config = config;
    }

    public string Issue(User user)
    {
        var secret = _config["Jwt:Secret"] ?? throw new InvalidOperationException("Jwt:Secret не настроен");
        var issuer = _config["Jwt:Issuer"] ?? "credit_calc";
        var audience = _config["Jwt:Audience"] ?? "credit_calc";
        var expirationDays = int.TryParse(_config["Jwt:ExpirationDays"], out var days) ? days : 30;

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, user.Id.ToString()),
            new Claim("telegram_id", user.TelegramId.ToString()),
        };

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            expires: DateTime.UtcNow.AddDays(expirationDays),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    /// <summary>Читает id пользователя (claim <c>sub</c>) из токена; <c>null</c>, если claim отсутствует/некорректен.</summary>
    public static ulong? GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue(ClaimTypes.NameIdentifier);
        return ulong.TryParse(sub, out var id) ? id : null;
    }
}
