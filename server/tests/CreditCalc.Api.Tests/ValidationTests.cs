using CreditCalc.Api.Contracts;
using FluentAssertions;

namespace CreditCalc.Api.Tests;

/// <summary>
/// По одному кейсу на каждое правило валидации из spec §3.2 tracker-design
/// (<see cref="MortgageRequest.Validate"/>, <see cref="MortgageEventRequest.Validate"/>)
/// и §7.2 mortgage-timeline-design (вычеты), плюс happy-path на валидные запросы.
/// </summary>
public class ValidationTests
{
    private static readonly DateOnly Today = DateOnly.FromDateTime(DateTime.UtcNow);

    private static MortgageRequest ValidMortgage() => new(
        Title: "Квартира на Ленина",
        Bank: "Сбер",
        PropertyPrice: 7_000_000m,
        DownPayment: 1_470_000m,
        Principal: 5_530_000m,
        Rate: 6m,
        TermMonths: 240,
        StartedOn: Today.AddDays(-30),
        MonthlyPayment: 39_620.5m,
        UsedPropertyBase: 0m,
        UsedInterestBase: 0m);

    [Fact]
    public void MortgageRequest_Valid_ReturnsNull()
    {
        ValidMortgage().Validate().Should().BeNull();
    }

    [Fact]
    public void MortgageRequest_EmptyTitle_ReturnsError()
    {
        (ValidMortgage() with { Title = "" }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_TitleTooLong_ReturnsError()
    {
        (ValidMortgage() with { Title = new string('a', 121) }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_BankTooLong_ReturnsError()
    {
        (ValidMortgage() with { Bank = new string('a', 121) }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_PropertyPriceZero_ReturnsError()
    {
        (ValidMortgage() with { PropertyPrice = 0 }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_DownPaymentGreaterOrEqualToPrice_ReturnsError()
    {
        (ValidMortgage() with { DownPayment = 7_000_000m }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_DownPaymentNegative_ReturnsError()
    {
        (ValidMortgage() with { DownPayment = -1 }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_PrincipalGreaterThanPrice_ReturnsError()
    {
        (ValidMortgage() with { Principal = 8_000_000m }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_PrincipalZero_ReturnsError()
    {
        (ValidMortgage() with { Principal = 0 }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_RateZero_ReturnsError()
    {
        (ValidMortgage() with { Rate = 0 }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_RateOver100_ReturnsError()
    {
        (ValidMortgage() with { Rate = 100.1m }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_TermMonthsZero_ReturnsError()
    {
        (ValidMortgage() with { TermMonths = 0 }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_TermMonthsOver600_ReturnsError()
    {
        (ValidMortgage() with { TermMonths = 601 }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_StartedOnTooFarInFuture_ReturnsError()
    {
        (ValidMortgage() with { StartedOn = Today.AddDays(2) }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_StartedOnTomorrow_IsValid()
    {
        (ValidMortgage() with { StartedOn = Today.AddDays(1) }).Validate().Should().BeNull();
    }

    [Fact]
    public void MortgageRequest_MonthlyPaymentZero_ReturnsError()
    {
        (ValidMortgage() with { MonthlyPayment = 0 }).Validate().Should().NotBeNull();
    }

    [Fact]
    public void MortgageRequest_MonthlyPaymentNull_IsValid()
    {
        (ValidMortgage() with { MonthlyPayment = null }).Validate().Should().BeNull();
    }

    // ─── Вычеты (spec §7.2 mortgage-timeline-design) ────────────────────────

    [Fact]
    public void MortgageRequest_UsedPropertyBaseNegative_ReturnsError()
    {
        (ValidMortgage() with { UsedPropertyBase = -1 }).Validate()
            .Should().Be("Использованная база имущественного вычета не может быть отрицательной");
    }

    [Fact]
    public void MortgageRequest_UsedPropertyBaseOverTwoMillion_ReturnsError()
    {
        // PropertyPrice = 7М в ValidMortgage(), лимит 2М меньше цены → упор в 2М
        (ValidMortgage() with { UsedPropertyBase = 2_000_001m }).Validate()
            .Should().Be("Использованная база имущественного вычета не может превышать 2 000 000 и стоимость недвижимости");
    }

    [Fact]
    public void MortgageRequest_UsedPropertyBaseOverCheapPropertyPrice_ReturnsError()
    {
        // Цена 1.5М < лимита 2М → упор в цену недвижимости, а не в лимит
        (ValidMortgage() with { PropertyPrice = 1_500_000m, DownPayment = 300_000m, Principal = 1_200_000m, UsedPropertyBase = 1_500_001m })
            .Validate().Should().Be("Использованная база имущественного вычета не может превышать 2 000 000 и стоимость недвижимости");
    }

    [Fact]
    public void MortgageRequest_UsedPropertyBaseAtLimit_IsValid()
    {
        (ValidMortgage() with { UsedPropertyBase = 2_000_000m }).Validate().Should().BeNull();
    }

    [Fact]
    public void MortgageRequest_UsedInterestBaseOverLimit_ReturnsError()
    {
        (ValidMortgage() with { UsedInterestBase = 3_000_001m }).Validate()
            .Should().Be("Использованная база вычета по процентам должна быть от 0 до 3 000 000");
    }

    [Fact]
    public void MortgageRequest_UsedInterestBaseNegative_ReturnsError()
    {
        (ValidMortgage() with { UsedInterestBase = -1 }).Validate()
            .Should().Be("Использованная база вычета по процентам должна быть от 0 до 3 000 000");
    }

    [Fact]
    public void MortgageRequest_UsedInterestBaseAtLimit_IsValid()
    {
        (ValidMortgage() with { UsedInterestBase = 3_000_000m }).Validate().Should().BeNull();
    }

    // ─── MortgageEventRequest ──────────────────────────────────────────────

    private static readonly DateOnly MortgageStartedOn = Today.AddYears(-1);

    private static MortgageEventRequest ValidPrepayment() => new(
        Kind: "prepayment",
        OccurredOn: Today,
        Amount: 300_000m,
        Rate: null,
        Note: "премия");

    [Fact]
    public void EventRequest_ValidPrepayment_ReturnsNull()
    {
        ValidPrepayment().Validate(MortgageStartedOn).Should().BeNull();
    }

    [Fact]
    public void EventRequest_ValidRateChange_ReturnsNull()
    {
        var request = new MortgageEventRequest("rate", Today, null, 17.5m, "слёт с льготной программы");

        request.Validate(MortgageStartedOn).Should().BeNull();
    }

    [Fact]
    public void EventRequest_ValidBalance_ReturnsNull()
    {
        var request = new MortgageEventRequest("balance", Today, 5_100_000m, null, "выписка из банка");

        request.Validate(MortgageStartedOn).Should().BeNull();
    }

    [Fact]
    public void EventRequest_UnknownKind_ReturnsError()
    {
        (ValidPrepayment() with { Kind = "unknown" }).Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_RateKindWithAmount_ReturnsError()
    {
        var request = new MortgageEventRequest("rate", Today, Amount: 1000m, Rate: 17.5m, Note: null);

        request.Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_RateKindMissingRate_ReturnsError()
    {
        var request = new MortgageEventRequest("rate", Today, Amount: null, Rate: null, Note: null);

        request.Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_BalanceKindMissingAmount_ReturnsError()
    {
        var request = new MortgageEventRequest("balance", Today, Amount: null, Rate: null, Note: null);

        request.Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_BalanceKindWithRate_ReturnsError()
    {
        var request = new MortgageEventRequest("balance", Today, Amount: 100_000m, Rate: 5m, Note: null);

        request.Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_OccurredOnBeforeMortgageStartedOn_ReturnsError()
    {
        (ValidPrepayment() with { OccurredOn = MortgageStartedOn.AddDays(-1) })
            .Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_OccurredOnMoreThanYearAhead_ReturnsError()
    {
        (ValidPrepayment() with { OccurredOn = Today.AddYears(1).AddDays(1) })
            .Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_NoteTooLong_ReturnsError()
    {
        (ValidPrepayment() with { Note = new string('a', 501) }).Validate(MortgageStartedOn).Should().NotBeNull();
    }

    [Fact]
    public void EventRequest_AmountZero_ReturnsError()
    {
        (ValidPrepayment() with { Amount = 0 }).Validate(MortgageStartedOn).Should().NotBeNull();
    }
}
