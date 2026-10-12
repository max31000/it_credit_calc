using System.Security.Claims;
using CreditCalc.Api.Data;
using Microsoft.Extensions.Caching.Memory;
using Mvv42.Auth.Client;

namespace CreditCalc.Api.Auth;

/// <summary>id приложения в mvv42-auth (claim <c>apps</c>, политика <see cref="Mvv42Auth.Policy"/>).</summary>
public static class Mvv42App
{
    public const string Id = "credit_calc";
}

/// <summary>
/// Локальный пользователь текущего запроса. Ключ — только claim <c>tg</c> (telegram id, UNIQUE в <c>users</c>);
/// <c>sub</c> — id пользователя в auth-сервисе и для локальных данных не используется никогда (spec §10.12).
/// </summary>
public interface ICurrentUser
{
    /// <summary>id строки <c>users</c>; создаёт её при первом обращении пользователя.</summary>
    Task<ulong> GetLocalUserIdAsync();
}

public sealed class CurrentUser(IHttpContextAccessor accessor, UserProvisioning provisioning, IMemoryCache cache) : ICurrentUser
{
    private ulong? _resolved;

    public async Task<ulong> GetLocalUserIdAsync()
    {
        if (_resolved is { } id)
            return id;

        var principal = accessor.HttpContext?.User ?? new ClaimsPrincipal();
        // FallbackPolicy пропускает в хендлер только mvv42-пользователя, так что null здесь — ошибка конфигурации.
        var me = principal.GetMvv42User()
                 ?? throw new InvalidOperationException("Запрос не аутентифицирован схемой mvv42");

        var localId = await cache.GetOrCreateAsync(CacheKey(me.TelegramId), entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(10);
            return provisioning.GetOrCreateAsync(me);
        });

        _resolved = localId;
        return localId;
    }

    internal static string CacheKey(long telegramId) => $"credit_calc:local-user:{telegramId}";
}

/// <summary>Находит или создаёт строку <c>users</c> для mvv42-пользователя (ключ — telegram id).</summary>
public sealed class UserProvisioning(IUserStore users)
{
    // Один инстанс API: сериализует всплеск первых параллельных запросов нового пользователя.
    // Между инстансами (или если гонка всё-таки случилась) страхует MySQL 1062 → повторное чтение.
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public async Task<ulong> GetOrCreateAsync(Mvv42User me)
    {
        if (await users.GetByTelegramIdAsync(me.TelegramId) is { } existing)
            return existing.Id;

        await Gate.WaitAsync();
        try
        {
            if (await users.GetByTelegramIdAsync(me.TelegramId) is { } created)
                return created.Id;

            var name = string.IsNullOrWhiteSpace(me.Name) ? null : me.Name.Trim();
            if (name is { Length: > 255 })
                name = name[..255]; // users.first_name VARCHAR(255)
            if (await users.TryCreateAsync(new User { TelegramId = me.TelegramId, FirstName = name }) is { } newId)
                return newId;

            // Duplicate key (1062): строку вставил другой запрос/инстанс — читаем её.
            return (await users.GetByTelegramIdAsync(me.TelegramId))?.Id
                   ?? throw new InvalidOperationException($"users.telegram_id={me.TelegramId}: duplicate key, но строки нет");
        }
        finally
        {
            Gate.Release();
        }
    }
}
