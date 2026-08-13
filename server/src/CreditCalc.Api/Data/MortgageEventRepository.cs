using CreditCalc.Api.Contracts;
using Dapper;

namespace CreditCalc.Api.Data;

/// <summary>Строка таблицы <c>mortgage_events</c>.</summary>
public class MortgageEvent
{
    public ulong Id { get; set; }
    public ulong MortgageId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public DateOnly OccurredOn { get; set; }
    public decimal? Amount { get; set; }
    public decimal? Rate { get; set; }
    public string? Note { get; set; }
    public DateTime CreatedAt { get; set; }
}

/// <summary>
/// Все методы принимают <c>userId</c> и фильтруют доступ через JOIN с <c>mortgages</c> (spec §5.3):
/// <c>JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId</c>. Чужая или
/// несуществующая ипотека → <c>null</c>/<c>false</c>, эндпоинт превращает это в 404.
/// </summary>
public class MortgageEventRepository
{
    private readonly Db _db;

    public MortgageEventRepository(Db db)
    {
        _db = db;
    }

    /// <summary>
    /// Все события всех ипотек пользователя одним запросом (spec §4.2/A5) — используется
    /// в <c>GET /api/mortgages</c>, чтобы список отдавался без N+1: один запрос на ипотеки,
    /// один на события, группировка в памяти. Порядок — <c>occurred_on ASC, id ASC</c>.
    /// </summary>
    public async Task<IReadOnlyList<MortgageEvent>> ListAllByUserAsync(ulong userId)
    {
        await using var connection = _db.Create();
        var rows = await connection.QueryAsync<MortgageEvent>(
            @"SELECT e.* FROM mortgage_events e
              JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId
              ORDER BY e.occurred_on ASC, e.id ASC",
            new { UserId = userId });
        return rows.ToList();
    }

    /// <summary><c>null</c> — ипотека не найдена/не принадлежит пользователю; иначе список (может быть пустым).</summary>
    public async Task<IReadOnlyList<MortgageEvent>?> ListAsync(ulong userId, ulong mortgageId)
    {
        await using var connection = _db.Create();

        if (!await OwnsMortgageAsync(connection, userId, mortgageId))
            return null;

        var rows = await connection.QueryAsync<MortgageEvent>(
            @"SELECT e.* FROM mortgage_events e
              JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId
              WHERE e.mortgage_id = @MortgageId
              ORDER BY e.occurred_on ASC, e.id ASC",
            new { MortgageId = mortgageId, UserId = userId });
        return rows.ToList();
    }

    /// <summary><c>null</c> — ипотека не найдена/не принадлежит пользователю.</summary>
    public async Task<MortgageEvent?> CreateAsync(ulong userId, ulong mortgageId, MortgageEventRequest request)
    {
        await using var connection = _db.Create();

        if (!await OwnsMortgageAsync(connection, userId, mortgageId))
            return null;

        var id = await connection.ExecuteScalarAsync<ulong>(
            @"INSERT INTO mortgage_events (mortgage_id, kind, occurred_on, amount, rate, note)
              VALUES (@MortgageId, @Kind, @OccurredOn, @Amount, @Rate, @Note);
              SELECT LAST_INSERT_ID();",
            new
            {
                MortgageId = mortgageId,
                request.Kind,
                request.OccurredOn,
                request.Amount,
                request.Rate,
                request.Note,
            });

        return await connection.QuerySingleOrDefaultAsync<MortgageEvent>(
            @"SELECT e.* FROM mortgage_events e
              JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId
              WHERE e.id = @Id",
            new { Id = id, UserId = userId });
    }

    public async Task<bool> DeleteAsync(ulong userId, ulong mortgageId, ulong eventId)
    {
        await using var connection = _db.Create();
        var rows = await connection.ExecuteAsync(
            @"DELETE e FROM mortgage_events e
              JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId
              WHERE e.id = @EventId AND e.mortgage_id = @MortgageId",
            new { UserId = userId, EventId = eventId, MortgageId = mortgageId });
        return rows > 0;
    }

    private static async Task<bool> OwnsMortgageAsync(MySqlConnector.MySqlConnection connection, ulong userId, ulong mortgageId)
    {
        var found = await connection.ExecuteScalarAsync<int?>(
            "SELECT 1 FROM mortgages WHERE id = @MortgageId AND user_id = @UserId",
            new { MortgageId = mortgageId, UserId = userId });
        return found.HasValue;
    }
}
