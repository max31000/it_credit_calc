using CreditCalc.Api.Contracts;
using Dapper;

namespace CreditCalc.Api.Data;

/// <summary>Строка таблицы <c>mortgages</c>.</summary>
public class Mortgage
{
    public ulong Id { get; set; }
    public ulong UserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Bank { get; set; }
    public decimal PropertyPrice { get; set; }
    public decimal DownPayment { get; set; }
    public decimal Principal { get; set; }
    public decimal Rate { get; set; }
    public int TermMonths { get; set; }
    public DateOnly StartedOn { get; set; }
    public decimal? MonthlyPayment { get; set; }
    public DateTime CreatedAt { get; set; }
    public DateTime UpdatedAt { get; set; }
}

/// <summary>
/// Все методы принимают <c>userId</c> первым аргументом и фильтруют по нему в SQL (spec §5.3) —
/// проверка владения не выносится в код эндпоинтов, забыть её здесь негде.
/// </summary>
public class MortgageRepository
{
    private readonly Db _db;

    public MortgageRepository(Db db)
    {
        _db = db;
    }

    public async Task<IReadOnlyList<Mortgage>> ListAsync(ulong userId)
    {
        await using var connection = _db.Create();
        var rows = await connection.QueryAsync<Mortgage>(
            "SELECT * FROM mortgages WHERE user_id = @UserId ORDER BY started_on DESC, id DESC",
            new { UserId = userId });
        return rows.ToList();
    }

    public async Task<Mortgage?> GetAsync(ulong userId, ulong id)
    {
        await using var connection = _db.Create();
        return await connection.QuerySingleOrDefaultAsync<Mortgage>(
            "SELECT * FROM mortgages WHERE id = @Id AND user_id = @UserId",
            new { Id = id, UserId = userId });
    }

    public async Task<ulong> CreateAsync(ulong userId, MortgageRequest request)
    {
        await using var connection = _db.Create();
        return await connection.ExecuteScalarAsync<ulong>(
            @"INSERT INTO mortgages
                  (user_id, title, bank, property_price, down_payment, principal, rate, term_months, started_on, monthly_payment)
              VALUES
                  (@UserId, @Title, @Bank, @PropertyPrice, @DownPayment, @Principal, @Rate, @TermMonths, @StartedOn, @MonthlyPayment);
              SELECT LAST_INSERT_ID();",
            new
            {
                UserId = userId,
                request.Title,
                request.Bank,
                request.PropertyPrice,
                request.DownPayment,
                request.Principal,
                request.Rate,
                request.TermMonths,
                request.StartedOn,
                request.MonthlyPayment,
            });
    }

    /// <summary>Возвращает обновлённую строку или <c>null</c>, если ипотека не найдена/чужая.</summary>
    public async Task<Mortgage?> UpdateAsync(ulong userId, ulong id, MortgageRequest request)
    {
        await using var connection = _db.Create();
        var rows = await connection.ExecuteAsync(
            @"UPDATE mortgages SET
                  title = @Title, bank = @Bank, property_price = @PropertyPrice, down_payment = @DownPayment,
                  principal = @Principal, rate = @Rate, term_months = @TermMonths,
                  started_on = @StartedOn, monthly_payment = @MonthlyPayment
              WHERE id = @Id AND user_id = @UserId",
            new
            {
                Id = id,
                UserId = userId,
                request.Title,
                request.Bank,
                request.PropertyPrice,
                request.DownPayment,
                request.Principal,
                request.Rate,
                request.TermMonths,
                request.StartedOn,
                request.MonthlyPayment,
            });

        if (rows == 0) return null;

        return await connection.QuerySingleOrDefaultAsync<Mortgage>(
            "SELECT * FROM mortgages WHERE id = @Id AND user_id = @UserId",
            new { Id = id, UserId = userId });
    }

    public async Task<bool> DeleteAsync(ulong userId, ulong id)
    {
        await using var connection = _db.Create();
        var rows = await connection.ExecuteAsync(
            "DELETE FROM mortgages WHERE id = @Id AND user_id = @UserId",
            new { Id = id, UserId = userId });
        return rows > 0;
    }
}
