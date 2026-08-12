namespace CreditCalc.Api.Contracts;

/// <summary>Тело <c>POST/PUT /api/mortgages/{id}</c>. Правила валидации — §3.2 спеки, дословно.</summary>
public record MortgageRequest(
    string Title,
    string? Bank,
    decimal PropertyPrice,
    decimal DownPayment,
    decimal Principal,
    decimal Rate,
    int TermMonths,
    DateOnly StartedOn,
    decimal? MonthlyPayment)
{
    /// <summary>Возвращает текст ошибки на русском или <c>null</c>, если запрос валиден.</summary>
    public string? Validate()
    {
        if (string.IsNullOrWhiteSpace(Title) || Title.Length > 120)
            return "Название обязательно и не длиннее 120 символов";

        if (Bank is { Length: > 120 })
            return "Название банка не длиннее 120 символов";

        if (PropertyPrice <= 0)
            return "Стоимость недвижимости должна быть больше нуля";

        if (DownPayment < 0 || DownPayment >= PropertyPrice)
            return "Первоначальный взнос должен быть неотрицательным и меньше стоимости недвижимости";

        if (Principal <= 0 || Principal > PropertyPrice)
            return "Сумма кредита должна быть больше нуля и не больше стоимости недвижимости";

        if (Rate <= 0 || Rate > 100)
            return "Ставка должна быть больше 0 и не больше 100 процентов";

        if (TermMonths is < 1 or > 600)
            return "Срок кредита должен быть от 1 до 600 месяцев";

        if (StartedOn > DateOnly.FromDateTime(DateTime.UtcNow).AddDays(1))
            return "Дата выдачи не может быть позже завтрашнего дня";

        if (MonthlyPayment is <= 0)
            return "Ежемесячный платёж должен быть больше нуля";

        return null;
    }
}

/// <summary>Тело <c>POST /api/mortgages/{id}/events</c>. Правила валидации — §2/§3.2 спеки.</summary>
public record MortgageEventRequest(
    string Kind,
    DateOnly OccurredOn,
    decimal? Amount,
    decimal? Rate,
    string? Note)
{
    private static readonly string[] ValidKinds = ["balance", "rate", "prepayment", "payment"];

    /// <summary>
    /// Возвращает текст ошибки на русском или <c>null</c>, если запрос валиден.
    /// <paramref name="mortgageStartedOn"/> — дата выдачи родительской ипотеки, нужна для
    /// проверки «дата корректировки не раньше даты выдачи».
    /// </summary>
    public string? Validate(DateOnly mortgageStartedOn)
    {
        if (!ValidKinds.Contains(Kind))
            return "Недопустимый вид корректировки";

        if (Kind == "rate")
        {
            if (Rate is null || Rate <= 0 || Rate > 100)
                return "Ставка должна быть больше 0 и не больше 100 процентов";
            if (Amount is not null)
                return "Для смены ставки поле amount должно быть пустым";
        }
        else
        {
            // balance | prepayment | payment
            if (Amount is null || Amount <= 0)
                return "Сумма должна быть больше нуля";
            if (Rate is not null)
                return "Поле rate должно быть пустым для этого вида корректировки";
        }

        if (OccurredOn < mortgageStartedOn)
            return "Дата корректировки не может быть раньше даты выдачи ипотеки";

        var maxDate = DateOnly.FromDateTime(DateTime.UtcNow).AddYears(1);
        if (OccurredOn > maxDate)
            return "Дата корректировки не может быть больше чем на год вперёд";

        if (Note is { Length: > 500 })
            return "Комментарий не длиннее 500 символов";

        return null;
    }
}
