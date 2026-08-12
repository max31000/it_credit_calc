using System.Security.Claims;
using CreditCalc.Api.Auth;
using CreditCalc.Api.Data;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.IdentityModel.Tokens;

namespace CreditCalc.Api.Tests;

public class JwtIssuerTests
{
    private const string TestSecret = "test-jwt-secret-key-at-least-32-characters-long";

    private static JwtIssuer CreateIssuer()
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Jwt:Secret"] = TestSecret,
                ["Jwt:Issuer"] = "credit_calc_test",
                ["Jwt:Audience"] = "credit_calc_test",
                ["Jwt:ExpirationDays"] = "30",
            })
            .Build();

        return new JwtIssuer(config);
    }

    [Fact]
    public void Issue_ThenReadBackWithGetUserId_ReturnsOriginalUserId()
    {
        var issuer = CreateIssuer();
        var user = new User { Id = 42, TelegramId = 123456789 };

        var token = issuer.Issue(user);

        // Читаем токен так же, как это делает AddJwtBearer в Program.cs.
        var handler = new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler();
        var principal = handler.ValidateToken(token, new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(System.Text.Encoding.UTF8.GetBytes(TestSecret)),
            ValidateIssuer = true,
            ValidIssuer = "credit_calc_test",
            ValidateAudience = true,
            ValidAudience = "credit_calc_test",
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
        }, out _);

        var userId = JwtIssuer.GetUserId(principal);

        userId.Should().Be(42UL);
    }

    [Fact]
    public void GetUserId_PrincipalWithoutClaim_ReturnsNull()
    {
        var principal = new ClaimsPrincipal(new ClaimsIdentity());

        JwtIssuer.GetUserId(principal).Should().BeNull();
    }

    [Fact]
    public void GetUserId_NonNumericClaim_ReturnsNull()
    {
        var identity = new ClaimsIdentity([new Claim(ClaimTypes.NameIdentifier, "not-a-number")]);
        var principal = new ClaimsPrincipal(identity);

        JwtIssuer.GetUserId(principal).Should().BeNull();
    }
}
