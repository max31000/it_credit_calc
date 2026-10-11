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
    [InlineData(JwtSecretGuard.CommittedDevSecret)]
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
        // appsettings.Production.json не задаёт Jwt:Secret, поэтому действует dev-значение
        // из appsettings.json — guard должен уронить старт до миграций.
        using var factory = new WebApplicationFactory<Program>()
            .WithWebHostBuilder(b => b.UseEnvironment("Production"));

        var act = () => factory.CreateClient();

        act.Should().Throw<Exception>()
            .Where(e => e.ToString().Contains("Jwt:Secret must be configured"));
    }
}
