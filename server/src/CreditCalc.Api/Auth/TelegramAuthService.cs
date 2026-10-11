using System.Security.Cryptography;
using System.Text;

namespace CreditCalc.Api.Auth;

/// <summary>
/// Проверяет подпись данных Telegram Login Widget. Порт из
/// bonds/src/Bonds.Infrastructure/Services/TelegramAuthService.cs без изменений алгоритма.
///
/// Алгоритм верификации (официальная документация Telegram):
/// 1. Из полученных данных убираем поле hash.
/// 2. Оставшиеся поля сортируем по алфавиту и объединяем через \n.
/// 3. secret_key = SHA256(bot_token).
/// 4. Проверяем: HMAC-SHA256(data_check_string, secret_key) == hash.
/// 5. Проверяем, что auth_date не старше 24 часов и не больше чем на 60 с в будущем.
///
/// В отличие от bonds здесь НЕТ allowlist (Telegram:OwnerId) — сервис мультипользовательский,
/// любой пользователь Telegram логинится и ведёт свои ипотеки (spec §3.1).
/// </summary>
public class TelegramAuthService
{
    private readonly byte[] _secretKey;

    public TelegramAuthService(IConfiguration configuration)
    {
        var botToken = configuration["Telegram:BotToken"]
            ?? throw new InvalidOperationException("Telegram:BotToken не настроен");

        // secret_key = SHA256(bot_token) — именно так требует Telegram
        _secretKey = SHA256.HashData(Encoding.UTF8.GetBytes(botToken));
    }

    public bool ValidateAuthData(TelegramAuthData data)
    {
        // 0. Без подписи проверять нечего: null/пустой hash (в т.ч. "hash": null в JSON) —
        //    штатный отказ (401), а не NullReferenceException → 500.
        if (string.IsNullOrEmpty(data.Hash))
            return false;

        // 1. Проверяем свежесть данных: не старше 24 часов и не из будущего
        //    (допуск 60 с на рассинхрон часов).
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (now - data.AuthDate > 86400)
            return false;
        if (data.AuthDate > now + 60)
            return false;

        // 2. Строим data_check_string: все поля кроме hash, отсортированные по ключу, через \n
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

        // 3. Вычисляем HMAC-SHA256
        var computedHash = Convert.ToHexString(
            HMACSHA256.HashData(_secretKey, Encoding.UTF8.GetBytes(dataCheckString))
        ).ToLowerInvariant();

        // 4. Сравниваем через time-constant comparison
        return CryptographicOperations.FixedTimeEquals(
            Encoding.UTF8.GetBytes(computedHash),
            Encoding.UTF8.GetBytes(data.Hash.ToLowerInvariant())
        );
    }
}
