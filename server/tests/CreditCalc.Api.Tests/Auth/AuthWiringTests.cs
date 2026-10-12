using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using FluentAssertions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;

namespace CreditCalc.Api.Tests.Auth;

/// <summary>
/// Подключение общего auth (addendum D): схема mvv42 по умолчанию, FallbackPolicy = Mvv42Auth.Policy,
/// анонимны только health. Токены — настоящие ES256 JWT, подписанные тестовым ключом (заглушка JWKS).
/// </summary>
public class AuthWiringTests(Mvv42AppFactory factory) : IClassFixture<Mvv42AppFactory>
{
    private static readonly string[] AnonymousRoutes = ["/health", "/api/health"];

    private sealed record Route(string Method, string Pattern, string Url, bool Anonymous);

    private List<Route> Routes()
    {
        _ = factory.CreateClient(); // старт хоста
        var source = factory.Services.GetRequiredService<EndpointDataSource>();
        return source.Endpoints.OfType<RouteEndpoint>()
            .Where(e => !(e.RoutePattern.RawText ?? "").Contains("*")) // MapFallback (404 для неизвестных путей)
            .SelectMany(e =>
            {
                var pattern = "/" + (e.RoutePattern.RawText ?? "").TrimStart('/');
                var url = Regex.Replace(pattern, @"\{[^}]+\}", "1");
                var anonymous = e.Metadata.GetMetadata<IAllowAnonymous>() is not null;
                var methods = e.Metadata.GetMetadata<Microsoft.AspNetCore.Routing.HttpMethodMetadata>()?.HttpMethods ?? ["GET"];
                return methods.Select(m => new Route(m, pattern, url, anonymous));
            })
            .ToList();
    }

    [Fact]
    public void OnlyHealthEndpoints_AreAnonymous()
    {
        var routes = Routes();
        routes.Should().Contain(r => r.Pattern.StartsWith("/api/mortgages"));
        routes.Should().Contain(r => r.Pattern.StartsWith("/api/profile"));
        routes.Where(r => r.Anonymous).Select(r => r.Pattern).Distinct()
            .Should().BeEquivalentTo(AnonymousRoutes);
        routes.Should().NotContain(r => r.Pattern.StartsWith("/api/auth"), "старый логин удалён");
    }

    [Fact]
    public async Task EveryNonHealthEndpoint_WithoutCookie_Returns401()
    {
        var client = factory.CreateClient();
        var protectedRoutes = Routes().Where(r => !r.Anonymous).ToList();
        protectedRoutes.Should().HaveCountGreaterThan(5);

        foreach (var route in protectedRoutes)
        {
            var response = await client.SendAsync(Mvv42AppFactory.Request(new HttpMethod(route.Method), route.Url));
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized, $"{route.Method} {route.Url}");
        }
    }

    [Theory]
    [InlineData("/health")]
    [InlineData("/api/health")]
    public async Task Health_IsAnonymous(string url)
    {
        var response = await factory.CreateClient().GetAsync(url);

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Contain("\"status\":\"ok\"");
    }

    [Fact]
    public async Task UnknownRoute_Is404_Not401()
    {
        var response = await factory.CreateClient().GetAsync("/api/nope");
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task OldTelegramLogin_IsGone()
    {
        var response = await factory.CreateClient().PostAsync("/api/auth/telegram",
            new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task BearerHeader_IsIgnored()
    {
        var request = Mvv42AppFactory.Request(HttpMethod.Get, "/api/mortgages");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Mvv42TestAuth.Token(1001));

        var response = await factory.CreateClient().SendAsync(request);

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task InvalidTokens_Return401()
    {
        var client = factory.CreateClient();
        var otherKey = new ECDsaSecurityKey(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = "test-key-1" };
        string[] tokens =
        [
            "a.b.c",
            Mvv42TestAuth.Token(1002, key: otherKey),
            Mvv42TestAuth.Token(1002, issuer: "https://evil.example/auth"),
            Mvv42TestAuth.Token(1002, expires: DateTime.UtcNow.AddMinutes(-5)),
        ];

        foreach (var token in tokens)
        {
            var response = await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, "/api/mortgages", token));
            response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        }
    }

    [Fact]
    public async Task UserWithoutAppAccess_Returns403()
    {
        var token = Mvv42TestAuth.Token(1003, apps: ["cashpulse"]);

        var response = await factory.CreateClient().SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, "/api/profile/settings", token));

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        factory.Users.Lookups.Should().NotContain(1003, "пользователь без доступа не провижинится");
    }

    [Fact]
    public async Task ValidCookie_PassesAuth_AndResolvesLocalUserByTg()
    {
        const long tg = 1004;
        var token = Mvv42TestAuth.Token(tg, sub: "777");

        var response = await factory.CreateClient().SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, "/api/profile/settings", token));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
        (await response.Content.ReadAsStringAsync()).Should().Contain("\"settings\":null");
        factory.Users.All.Should().ContainSingle(u => u.TelegramId == tg)
            .Which.Id.Should().NotBe(777UL);
    }

    [Fact]
    public async Task AdminWithoutAppInApps_IsAllowed()
    {
        var token = Mvv42TestAuth.Token(1005, apps: [], admin: true);

        var response = await factory.CreateClient().SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, "/api/mortgages", token));

        response.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    private static HttpRequestMessage Json(HttpMethod method, string url, string token, object body)
    {
        var request = Mvv42AppFactory.Request(method, url, token, Mvv42TestAuth.Origin);
        request.Content = JsonContent.Create(body);
        return request;
    }

    private static object MortgageBody(string title) => new
    {
        title, bank = (string?)null, propertyPrice = 9_000_000, downPayment = 1_800_000, principal = 7_200_000,
        rate = 6, termMonths = 240, startedOn = "2024-01-15", monthlyPayment = (decimal?)null,
        usedPropertyBase = 0, usedInterestBase = 0,
    };

    [Fact]
    public async Task UsersSeeOnlyTheirOwnData()
    {
        var client = factory.CreateClient();
        // одинаковый sub у обоих — изоляция держится на tg → локальный id, а не на sub
        var alice = Mvv42TestAuth.Token(2001, sub: "1");
        var bob = Mvv42TestAuth.Token(2002, sub: "1");

        var created = await client.SendAsync(Json(HttpMethod.Post, "/api/mortgages", alice, MortgageBody("Квартира Алисы")));
        created.StatusCode.Should().Be(HttpStatusCode.Created);
        var id = (await created.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetUInt64();
        (await client.SendAsync(Json(HttpMethod.Put, "/api/profile/settings", alice, new
        {
            version = 2,
            settings = new { salary = 300_000, depositRate = 15, freeMonthly = 100_000, horizonYears = 10, keyRate = 16, bankDiscount = 0.5, startingSavings = 1_000_000 },
        }))).StatusCode.Should().Be(HttpStatusCode.OK);

        var bobList = await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, "/api/mortgages", bob));
        bobList.StatusCode.Should().Be(HttpStatusCode.OK);
        (await bobList.Content.ReadFromJsonAsync<JsonElement>()).GetArrayLength().Should().Be(0);

        (await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, $"/api/mortgages/{id}", bob))).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
        (await client.SendAsync(Json(HttpMethod.Put, $"/api/mortgages/{id}", bob, MortgageBody("взлом")))).StatusCode
            .Should().Be(HttpStatusCode.NotFound);
        (await client.SendAsync(Json(HttpMethod.Post, $"/api/mortgages/{id}/events", bob,
            new { kind = "balance", occurredOn = "2025-01-01", amount = 1, rate = (decimal?)null, note = (string?)null })))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        (await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Delete, $"/api/mortgages/{id}", bob, Mvv42TestAuth.Origin)))
            .StatusCode.Should().Be(HttpStatusCode.NotFound);
        var bobSettings = await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, "/api/profile/settings", bob));
        (await bobSettings.Content.ReadAsStringAsync()).Should().Contain("\"settings\":null");

        var aliceGet = await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Get, $"/api/mortgages/{id}", alice));
        aliceGet.StatusCode.Should().Be(HttpStatusCode.OK);
        factory.Mortgages.Find(id)!.Title.Should().Be("Квартира Алисы");
    }

    [Fact]
    public async Task UnsafeRequest_WithCookie_RequiresAllowedOrigin()
    {
        var token = Mvv42TestAuth.Token(1006);
        var client = factory.CreateClient();

        var noOrigin = await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Post, "/api/mortgages", token));
        noOrigin.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await noOrigin.Content.ReadAsStringAsync()).Should().Contain("origin_not_allowed");

        var sameOrigin = await client.SendAsync(Mvv42AppFactory.Request(HttpMethod.Post, "/api/mortgages", token, Mvv42TestAuth.Origin));
        sameOrigin.StatusCode.Should().Be(HttpStatusCode.BadRequest, "пустое тело не проходит валидацию — но auth и Origin пройдены");
    }
}
