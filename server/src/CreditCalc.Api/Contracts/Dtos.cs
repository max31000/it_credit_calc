namespace CreditCalc.Api.Contracts;

public record MortgageDto(
    ulong Id,
    string Title,
    string? Bank,
    decimal PropertyPrice,
    decimal DownPayment,
    decimal Principal,
    decimal Rate,
    int TermMonths,
    DateOnly StartedOn,
    decimal? MonthlyPayment,
    DateTime CreatedAt,
    DateTime UpdatedAt);

public record MortgageEventDto(
    ulong Id,
    ulong MortgageId,
    string Kind,
    DateOnly OccurredOn,
    decimal? Amount,
    decimal? Rate,
    string? Note,
    DateTime CreatedAt);

/// <summary>Ответ <c>GET /api/mortgages/{id}</c> — ипотека вместе с историей событий.</summary>
public record MortgageDetailsDto(MortgageDto Mortgage, IReadOnlyList<MortgageEventDto> Events);

public record AuthUserDto(ulong Id, long TelegramId, string? Username, string? FirstName, string? LastName);

/// <summary>Ответ <c>POST /api/auth/telegram</c>.</summary>
public record AuthResponseDto(string Token, AuthUserDto User);
