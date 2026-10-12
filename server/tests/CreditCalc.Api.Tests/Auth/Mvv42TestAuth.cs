using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using CreditCalc.Api.Data;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Protocols;
using Microsoft.IdentityModel.Protocols.OpenIdConnect;
using Microsoft.IdentityModel.Tokens;
using Mvv42.Auth.Client;

namespace CreditCalc.Api.Tests.Auth;

/// <summary>
/// Тестовый «auth-сервис»: ES256-ключ, которым подписываются access-токены как у mvv42-auth, и заглушка JWKS
/// (конфигурация схемы <c>mvv42</c> отдаёт этот ключ вместо похода в <c>http://mvv42-auth:8080</c>).
/// Валидация — настоящая: JwtBearer из SDK с его issuer/audience/алгоритмом/cookie.
/// </summary>
public static class Mvv42TestAuth
{
    public const string CookieName = "mvv42_at";
    public const string Origin = "https://mvv42.ru";

    public static readonly ECDsaSecurityKey SigningKey = new(ECDsa.Create(ECCurve.NamedCurves.nistP256)) { KeyId = "test-key-1" };

    /// <summary>Access-токен с claim'ами как у mvv42-auth: sub, tg, name, adm, apps (массив).</summary>
    public static string Token(
        long telegramId,
        string sub = "999",
        string[]? apps = null,
        bool admin = false,
        string issuer = "https://mvv42.ru/auth",
        DateTime? expires = null,
        SecurityKey? key = null)
    {
        var claims = new Dictionary<string, object>
        {
            ["sub"] = sub,
            ["tg"] = telegramId.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["name"] = "Max V",
            ["adm"] = admin ? "true" : "false",
            ["apps"] = apps ?? ["credit_calc"],
        };
        var now = DateTime.UtcNow;
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = issuer,
            Audience = "mvv42",
            Claims = claims,
            IssuedAt = now.AddMinutes(-1),
            NotBefore = now.AddMinutes(-1),
            Expires = expires ?? now.AddMinutes(10),
            SigningCredentials = new SigningCredentials(key ?? SigningKey, SecurityAlgorithms.EcdsaSha256),
        });
    }

    /// <summary>Заглушка JWKS: та же форма, что у SDK (Issuer + SigningKeys), без сети.</summary>
    private sealed class StubJwks : IConfigurationManager<OpenIdConnectConfiguration>
    {
        private readonly OpenIdConnectConfiguration _config = Create();

        private static OpenIdConnectConfiguration Create()
        {
            var config = new OpenIdConnectConfiguration { Issuer = "https://mvv42.ru/auth" };
            config.SigningKeys.Add(SigningKey);
            return config;
        }

        public Task<OpenIdConnectConfiguration> GetConfigurationAsync(CancellationToken cancel) => Task.FromResult(_config);

        public void RequestRefresh() { }
    }

    public static void UseStubJwks(this IServiceCollection services) =>
        services.PostConfigure<JwtBearerOptions>(Mvv42Auth.Scheme, o => o.ConfigurationManager = new StubJwks());
}

/// <summary>In-memory <see cref="IUserStore"/>: telegram id → локальный id (начиная с 5, чтобы не совпадать с sub).</summary>
public sealed class FakeUserStore : IUserStore
{
    private readonly ConcurrentDictionary<long, User> _users = new();
    private ulong _nextId = 4;

    public int Creates;
    public readonly ConcurrentBag<long> Lookups = [];

    /// <summary>Имитация гонки: первая вставка «проигрывает» (как MySQL 1062) — строку создаёт «другой запрос».</summary>
    public bool SimulateDuplicateOnce;

    public IReadOnlyCollection<User> All => _users.Values.ToList();

    public User Seed(long telegramId, ulong id)
    {
        var user = new User { Id = id, TelegramId = telegramId };
        _users[telegramId] = user;
        return user;
    }

    public Task<User?> GetByTelegramIdAsync(long telegramId)
    {
        Lookups.Add(telegramId);
        return Task.FromResult(_users.GetValueOrDefault(telegramId));
    }

    public async Task<ulong?> TryCreateAsync(User user)
    {
        await Task.Yield();
        Interlocked.Increment(ref Creates);
        if (SimulateDuplicateOnce)
        {
            SimulateDuplicateOnce = false;
            Seed(user.TelegramId, Interlocked.Increment(ref _nextId));
            return null;
        }
        if (_users.ContainsKey(user.TelegramId))
            return null;
        user.Id = Interlocked.Increment(ref _nextId);
        _users[user.TelegramId] = user;
        return user.Id;
    }
}

/// <summary>Приложение в окружении Testing (без MySQL-миграций) с заглушкой JWKS и in-memory пользователями.</summary>
public class Mvv42AppFactory : WebApplicationFactory<Program>
{
    public FakeUserStore Users { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("Mvv42Auth:CookieName", Mvv42TestAuth.CookieName);
        // Недоступная БД: хендлер, дошедший до репозитория, падает быстро (→ 500), а не висит на таймауте.
        builder.UseSetting("ConnectionStrings:DefaultConnection",
            "Server=127.0.0.1;Port=1;Database=none;User=none;Password=none;ConnectionTimeout=1;");
        builder.ConfigureServices(services =>
        {
            services.UseStubJwks();
            services.RemoveAll<IUserStore>();
            services.AddSingleton<IUserStore>(Users);
        });
    }

    public static HttpRequestMessage Request(HttpMethod method, string url, string? token = null, string? origin = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (token is not null) request.Headers.Add("Cookie", $"{Mvv42TestAuth.CookieName}={token}");
        if (origin is not null) request.Headers.Add("Origin", origin);
        if (method == HttpMethod.Post || method == HttpMethod.Put)
            request.Content = new StringContent("{}", System.Text.Encoding.UTF8, "application/json");
        return request;
    }
}

internal static class ClaimsPrincipals
{
    /// <summary>Principal как после схемы mvv42 (AuthenticationType = mvv42, имена claim'ов из JWT).</summary>
    public static ClaimsPrincipal Mvv42(long telegramId, string sub) =>
        new(new ClaimsIdentity(
            [new Claim("sub", sub), new Claim("tg", telegramId.ToString(System.Globalization.CultureInfo.InvariantCulture)), new Claim("name", "Max V")],
            Mvv42Auth.Scheme, "name", null));
}
