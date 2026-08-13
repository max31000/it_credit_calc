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
    DateTime UpdatedAt,
    decimal UsedPropertyBase,
    decimal UsedInterestBase);

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

/// <summary>
/// Настройки аккаунта, хранимые на сервере (spec §4.1 tracker-design, §7.1 mortgage-timeline-design).
/// <c>Salary</c> и <c>StartingSavings</c> — nullable поля: <c>StartingSavings</c> nullable потому,
/// что строки, записанные версией 1 (без этого поля), читаются как <c>null</c> и нормализуются
/// в <c>0</c> при отдаче — миграция данных не требуется.
/// </summary>
public record UserSettingsDto(
    decimal? Salary,
    decimal DepositRate,
    decimal FreeMonthly,
    int HorizonYears,
    decimal KeyRate,
    decimal BankDiscount,
    decimal? StartingSavings);

/// <summary>Ответ <c>GET/PUT /api/profile/settings</c>. <c>Settings = null</c> — пользователь ещё не сохранял настройки.</summary>
public record UserSettingsResponse(int Version, UserSettingsDto? Settings, DateTime? UpdatedAt);
