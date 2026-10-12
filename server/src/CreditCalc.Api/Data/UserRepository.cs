using Dapper;
using MySqlConnector;

namespace CreditCalc.Api.Data;

/// <summary>Строка таблицы <c>users</c>.</summary>
public class User
{
    public ulong Id { get; set; }
    public long TelegramId { get; set; }
    public string? Username { get; set; }
    public string? FirstName { get; set; }
    public string? LastName { get; set; }
    public string? PhotoUrl { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>Минимальный контракт хранилища пользователей для провижининга (подменяется в тестах).</summary>
public interface IUserStore
{
    Task<User?> GetByTelegramIdAsync(long telegramId);

    /// <summary>Создаёт пользователя; <c>null</c>, если <c>telegram_id</c> уже занят (MySQL 1062, гонка вставок).</summary>
    Task<ulong?> TryCreateAsync(User user);

    /// <summary>Обновляет отображаемое имя (из claim <c>name</c> токена).</summary>
    Task UpdateNameAsync(ulong id, string firstName);
}

public class UserRepository : IUserStore
{
    private readonly Db _db;

    public UserRepository(Db db)
    {
        _db = db;
    }

    public async Task<User?> GetByTelegramIdAsync(long telegramId)
    {
        await using var connection = _db.Create();
        return await connection.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM users WHERE telegram_id = @TelegramId",
            new { TelegramId = telegramId });
    }

    public async Task<User?> GetByIdAsync(ulong id)
    {
        await using var connection = _db.Create();
        return await connection.QuerySingleOrDefaultAsync<User>(
            "SELECT * FROM users WHERE id = @Id",
            new { Id = id });
    }

    public async Task<ulong> CreateAsync(User user)
    {
        await using var connection = _db.Create();
        return await connection.ExecuteScalarAsync<ulong>(
            @"INSERT INTO users (telegram_id, username, first_name, last_name, photo_url)
              VALUES (@TelegramId, @Username, @FirstName, @LastName, @PhotoUrl);
              SELECT LAST_INSERT_ID();",
            user);
    }

    public async Task UpdateNameAsync(ulong id, string firstName)
    {
        await using var connection = _db.Create();
        await connection.ExecuteAsync(
            "UPDATE users SET first_name = @FirstName WHERE id = @Id",
            new { Id = id, FirstName = firstName });
    }

    public async Task<ulong?> TryCreateAsync(User user)
    {
        try
        {
            return await CreateAsync(user);
        }
        catch (MySqlException ex) when (ex.ErrorCode == MySqlErrorCode.DuplicateKeyEntry)
        {
            // uq_users_telegram_id: параллельный запрос того же пользователя вставил строку первым.
            return null;
        }
    }
}
