using CreditCalc.Api.Auth;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Hosting;

namespace CreditCalc.Api.Tests;

public class JwtSecretGuardTests
{
    private sealed class Env(string name) : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = name;
        public string ApplicationName { get; set; } = "CreditCalc.Api";
        public string ContentRootPath { get; set; } = AppContext.BaseDirectory;
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }

    private const string StrongSecret = "a-real-production-secret-value-of-sufficient-length";

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("too-short-secret")]
    [InlineData("dev-secret-change-in-production-min-32-chars!!")]
    [InlineData("dev-secret-change-me-min-32-characters!!")]
    [InlineData("dev-only-secret-key-do-not-use-in-prod-32chars")]
    [InlineData("prod-but-still-a-DEV-SECRET-0123456789abcdef")]
    public void Production_WithWeakSecret_Throws(string? secret)
    {
        var act = () => JwtSecretGuard.Validate(new Env("Production"), secret);

        act.Should().Throw<InvalidOperationException>().WithMessage("Jwt:Secret must be configured*");
    }

    [Fact]
    public void Production_WithStrongSecret_DoesNotThrow()
    {
        var act = () => JwtSecretGuard.Validate(new Env("Production"), StrongSecret);

        act.Should().NotThrow();
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Testing")]
    public void DevelopmentAndTesting_AllowDevSecret(string environment)
    {
        var act = () => JwtSecretGuard.Validate(new Env(environment), JwtSecretGuard.CommittedDevSecret);

        act.Should().NotThrow();
    }

    [Fact]
    public void App_InProductionWithCommittedDevSecret_FailsToStart()
    {
        // Dev-секрет задаём явно, чтобы тест не зависел от окружения (Jwt__Secret в env CI/машины):
        // guard должен уронить старт до миграций.
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b
                .UseEnvironment("Production")
                .UseSetting("Jwt:Secret", JwtSecretGuard.CommittedDevSecret));

        var act = () => factory.CreateClient();

        act.Should().Throw<Exception>()
            .Where(e => e.ToString().Contains("Jwt:Secret must be configured"));
    }
}
