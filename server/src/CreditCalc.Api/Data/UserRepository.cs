using Dapper;

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

public class UserRepository
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

    public async Task UpdateAsync(User user)
    {
        await using var connection = _db.Create();
        await connection.ExecuteAsync(
            @"UPDATE users
              SET username = @Username, first_name = @FirstName, last_name = @LastName, photo_url = @PhotoUrl
              WHERE id = @Id",
            user);
    }
}
