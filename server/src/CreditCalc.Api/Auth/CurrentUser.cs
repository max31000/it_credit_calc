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

    /// <summary>
    /// Забыть закэшированный id (например, запись по нему упала на FK: строку <c>users</c> удалили руками) —
    /// следующий запрос найдёт/создаст пользователя заново.
    /// </summary>
    void Invalidate();
}

public sealed class CurrentUser(IHttpContextAccessor accessor, UserProvisioning provisioning, IMemoryCache cache) : ICurrentUser
{
    private ulong? _resolved;
    private long? _telegramId;

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
        _telegramId = me.TelegramId;
        return localId;
    }

    public void Invalidate()
    {
        var tg = _telegramId ?? (accessor.HttpContext?.User ?? new ClaimsPrincipal()).GetMvv42User()?.TelegramId;
        if (tg is { } telegramId)
            cache.Remove(CacheKey(telegramId));
        _resolved = null;
    }

    internal static string CacheKey(long telegramId) => $"credit_calc:local-user:{telegramId}";
}

/// <summary>
/// Находит или создаёт строку <c>users</c> для mvv42-пользователя (ключ — telegram id). Вызывается только
/// на промахе кэша <see cref="CurrentUser"/> (не чаще раза в 10 мин на пользователя) — там же дёшево
/// обновляется имя, если в токене оно другое. username/photo в access-токене нет — их не трогаем.
/// </summary>
public sealed class UserProvisioning(IUserStore users)
{
    // Один инстанс API: сериализует всплеск первых параллельных запросов нового пользователя.
    // Между инстансами (или если гонка всё-таки случилась) страхует MySQL 1062 → повторное чтение.
    private static readonly SemaphoreSlim Gate = new(1, 1);
    internal static TimeSpan GateTimeout = TimeSpan.FromSeconds(10);

    public async Task<ulong> GetOrCreateAsync(Mvv42User me)
    {
        var name = NormalizeName(me.Name);
        if (await users.GetByTelegramIdAsync(me.TelegramId) is { } existing)
            return await WithFreshNameAsync(existing, name);

        if (!await Gate.WaitAsync(GateTimeout))
            throw new TimeoutException($"users.telegram_id={me.TelegramId}: провижининг занят дольше {GateTimeout}");
        try
        {
            if (await users.GetByTelegramIdAsync(me.TelegramId) is { } created)
                return created.Id;

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

    private async Task<ulong> WithFreshNameAsync(User user, string? name)
    {
        if (name is not null && !string.Equals(user.FirstName, name, StringComparison.Ordinal))
            await users.UpdateNameAsync(user.Id, name);
        return user.Id;
    }

    private static string? NormalizeName(string? raw)
    {
        var name = string.IsNullOrWhiteSpace(raw) ? null : raw.Trim();
        return name is { Length: > 255 } ? name[..255] : name; // users.first_name VARCHAR(255)
    }
}
