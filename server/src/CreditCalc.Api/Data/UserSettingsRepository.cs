using System.Text.Json;
using CreditCalc.Api.Contracts;
using Dapper;

namespace CreditCalc.Api.Data;

/// <summary>Строка таблицы <c>user_settings</c> — одна на пользователя, <c>Data</c> — сырой JSON из колонки.</summary>
public class UserSettingsRow
{
    public ulong UserId { get; set; }
    public int Version { get; set; }
    public string Data { get; set; } = "{}";
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Шесть настроек аккаунта хранятся одной строкой на пользователя: <c>PRIMARY KEY (user_id)</c>
/// в <c>user_settings</c> — доступ к чужим настройкам недостижим, параметра для этого нет
/// (spec §5.2). DTO ↔ JSON — <see cref="JsonSerializer"/> с теми же соглашениями (camelCase),
/// что и остальной API; опции статические, не создаются на каждый вызов.
/// </summary>
public class UserSettingsRepository
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private readonly Db _db;
    private readonly ILogger<UserSettingsRepository> _logger;

    public UserSettingsRepository(Db db, ILogger<UserSettingsRepository> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<UserSettingsRow?> GetAsync(ulong userId)
    {
        await using var connection = _db.Create();
        return await connection.QuerySingleOrDefaultAsync<UserSettingsRow>(
            "SELECT * FROM user_settings WHERE user_id = @UserId",
            new { UserId = userId });
    }

    public async Task<UserSettingsRow> UpsertAsync(ulong userId, int version, string dataJson)
    {
        await using var connection = _db.Create();
        await connection.ExecuteAsync(
            @"INSERT INTO user_settings (user_id, version, data)
              VALUES (@UserId, @Version, @Data)
              ON DUPLICATE KEY UPDATE version = VALUES(version), data = VALUES(data)",
            new { UserId = userId, Version = version, Data = dataJson });

        return await connection.QuerySingleAsync<UserSettingsRow>(
            "SELECT * FROM user_settings WHERE user_id = @UserId",
            new { UserId = userId });
    }

    public static string Serialize(UserSettingsDto settings) => JsonSerializer.Serialize(settings, JsonOptions);

    /// <summary>
    /// Битый JSON в колонке (руками поправили в БД) → <c>Warning</c> в лог и <c>null</c>,
    /// а не необработанное исключение (500).
    /// </summary>
    public UserSettingsDto? Deserialize(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<UserSettingsDto>(json, JsonOptions);
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Не удалось десериализовать user_settings.data");
            return null;
        }
    }
}
