using System.Security.Cryptography;
using System.Text;
using CreditCalc.Api.Auth;
using FluentAssertions;
using Microsoft.Extensions.Configuration;

namespace CreditCalc.Api.Tests;

/// <summary>
/// Юнит-тесты <see cref="TelegramAuthService.ValidateAuthData"/>. Порт сценариев из
/// bonds/tests/Bonds.Tests/TelegramAuthServiceTests.cs.
/// </summary>
public class TelegramAuthServiceTests
{
    private const string TestBotToken = "1234567890:ABCDEFghijklmnopqrstuvwxyz_test_token";

    // secret_key = SHA256(bot_token) — зеркалит конструктор TelegramAuthService
    private static readonly byte[] SecretKey = SHA256.HashData(Encoding.UTF8.GetBytes(TestBotToken));

    private static TelegramAuthService CreateService(string botToken = TestBotToken)
    {
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["Telegram:BotToken"] = botToken,
            })
            .Build();

        return new TelegramAuthService(config);
    }

    /// <summary>Строит корректный hash для данных тем же алгоритмом, что и TelegramAuthService.</summary>
    private static string ComputeHash(TelegramAuthData data)
    {
        var fields = new SortedDictionary<string, string>
        {
            ["id"] = data.Id.ToString(),
            ["auth_date"] = data.AuthDate.ToString(),
        };

        if (!string.IsNullOrEmpty(data.FirstName)) fields["first_name"] = data.FirstName;
        if (!string.IsNullOrEmpty(data.LastName)) fields["last_name"] = data.LastName;
        if (!string.IsNullOrEmpty(data.Username)) fields["username"] = data.Username;
        if (!string.IsNullOrEmpty(data.PhotoUrl)) fields["photo_url"] = data.PhotoUrl;

        var dataCheckString = string.Join("\n", fields.Select(kv => $"{kv.Key}={kv.Value}"));

        return Convert.ToHexString(
            HMACSHA256.HashData(SecretKey, Encoding.UTF8.GetBytes(dataCheckString))
        ).ToLowerInvariant();
    }

    private static long FreshAuthDate() => DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 60;
    private static long ExpiredAuthDate() => DateTimeOffset.UtcNow.ToUnixTimeSeconds() - 86401;

    [Fact]
    public void ValidSignature_ReturnsTrue()
    {
        var svc = CreateService();

        var data = new TelegramAuthData
        {
            Id = 123456789,
            FirstName = "Максим",
            Username = "maksim",
            AuthDate = FreshAuthDate(),
            Hash = string.Empty,
        };
        data = data with { Hash = ComputeHash(data) };

        svc.ValidateAuthData(data).Should().BeTrue();
    }

    [Fact]
    public void TamperedHash_ReturnsFalse()
    {
        var svc = CreateService();

        var data = new TelegramAuthData
        {
            Id = 123456789,
            FirstName = "Максим",
            AuthDate = FreshAuthDate(),
            Hash = "0000000000000000000000000000000000000000000000000000000000000000",
        };

        svc.ValidateAuthData(data).Should().BeFalse();
    }

    [Fact]
    public void ExpiredAuthDate_TwoDaysOld_ReturnsFalse()
    {
        var svc = CreateService();

        var data = new TelegramAuthData
        {
            Id = 987654321,
            AuthDate = DateTimeOffset.UtcNow.AddDays(-2).ToUnixTimeSeconds(),
            Hash = string.Empty,
        };
        data = data with { Hash = ComputeHash(data) };

        svc.ValidateAuthData(data).Should().BeFalse();
    }

    [Fact]
    public void ExpiredAuthDate_JustOverLimit_ReturnsFalse()
    {
        var svc = CreateService();

        var data = new TelegramAuthData
        {
            Id = 987654321,
            AuthDate = ExpiredAuthDate(),
            Hash = string.Empty,
        };
        data = data with { Hash = ComputeHash(data) };

        svc.ValidateAuthData(data).Should().BeFalse();
    }

    [Fact]
    public void EmptyOptionalFields_AreExcludedFromDataCheckString()
    {
        // Пустые необязательные поля (LastName/Username/PhotoUrl = null) не должны попадать
        // в data_check_string — иначе валидный виджет-запрос без этих полей не пройдёт проверку.
        var svc = CreateService();

        var data = new TelegramAuthData
        {
            Id = 111,
            FirstName = "Пётр",
            LastName = null,
            Username = null,
            PhotoUrl = null,
            AuthDate = FreshAuthDate(),
            Hash = string.Empty,
        };
        data = data with { Hash = ComputeHash(data) };

        svc.ValidateAuthData(data).Should().BeTrue();
    }
}
