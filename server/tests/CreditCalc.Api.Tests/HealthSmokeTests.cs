using System.Net;
using FluentAssertions;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;

namespace CreditCalc.Api.Tests;

/// <summary>
/// Смоук-тесты через <see cref="WebApplicationFactory{TEntryPoint}"/> в окружении Testing —
/// без Docker/реальной MySQL (Program.cs пропускает MigrationRunner.RunAsync в этом окружении,
/// а TelegramAuthService/репозитории не конструируются для этих двух маршрутов).
/// </summary>
public class HealthSmokeTests : IClassFixture<HealthSmokeTests.TestingWebApplicationFactory>
{
    private readonly TestingWebApplicationFactory _factory;

    public HealthSmokeTests(TestingWebApplicationFactory factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task Health_ReturnsOk()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("\"status\":\"ok\"");
    }

    [Fact]
    public async Task GetMortgages_WithoutToken_ReturnsUnauthorized()
    {
        var client = _factory.CreateClient();

        var response = await client.GetAsync("/api/mortgages");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    public class TestingWebApplicationFactory : WebApplicationFactory<Program>
    {
        protected override void ConfigureWebHost(IWebHostBuilder builder)
        {
            builder.UseEnvironment("Testing");
        }
    }
}
