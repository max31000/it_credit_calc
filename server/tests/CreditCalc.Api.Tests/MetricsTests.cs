using System.Net;
using CreditCalc.Api.Tests.Auth;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Prometheus;

namespace CreditCalc.Api.Tests;

/// <summary>
/// Контракт метрик (mvv42-infra-mon, 2026-10-16-app-metrics): /metrics отдаёт только отдельный
/// KestrelMetricServer (порт 9091), основной порт — 404; HTTP-метрики размечены шаблоном маршрута,
/// а не сырым путём с id.
/// </summary>
public class MetricsTests(Mvv42AppFactory factory) : IClassFixture<Mvv42AppFactory>
{
    [Theory]
    [InlineData("/metrics")]
    [InlineData("/api/metrics")] // так выглядит /credit_calc/api/metrics после nginx фронта
    public async Task MainApp_DoesNotServeMetrics(string url)
    {
        var response = await factory.CreateClient().GetAsync(url);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await response.Content.ReadAsStringAsync()).Should().NotContain("# TYPE");
    }

    [Fact]
    public async Task HttpMetrics_UseRouteTemplate_NotConcretePath()
    {
        var client = factory.CreateClient();
        await client.GetAsync("/api/mortgages/9876543");
        await client.GetAsync("/api/mortgages/9876543/events");

        var text = await ExportAsync();

        text.Should().Contain("http_requests_received_total");
        text.Should().Contain("endpoint=\"/api/mortgages/{id}\"");
        text.Should().Contain("endpoint=\"/api/mortgages/{id}/events\"");
        text.Should().Contain("code=\"4xx\"");
        text.Should().NotContain("9876543");
    }

    [Fact]
    public void MetricServer_DisabledByPortZero()
    {
        _ = factory.CreateClient();

        factory.Services.GetServices<IHostedService>()
            .Should().NotContain(s => s.GetType().Name.Contains("Metric"));
    }

    private static async Task<string> ExportAsync()
    {
        using var stream = new MemoryStream();
        await Metrics.DefaultRegistry.CollectAndExportAsTextAsync(stream);
        return System.Text.Encoding.UTF8.GetString(stream.ToArray());
    }
}
