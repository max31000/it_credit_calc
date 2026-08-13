using CreditCalc.Api.Contracts;
using FluentAssertions;

namespace CreditCalc.Api.Tests;

/// <summary>
/// По одному кейсу на каждое правило валидации <see cref="UserSettingsRequest.Validate"/>
/// (таблица §4.1 спеки tracker-design + §7.1 спеки mortgage-timeline-design: версия 1|2,
/// диапазон <c>StartingSavings</c>), плюс happy-path. Чистые юниты, БД не нужна — как <c>ValidationTests</c>.
/// </summary>
public class UserSettingsValidationTests
{
    private static UserSettingsDto ValidSettings() => new(
        Salary: 350_000m,
        DepositRate: 16m,
        FreeMonthly: 100_000m,
        HorizonYears: 10,
        KeyRate: 16m,
        BankDiscount: 0.5m,
        StartingSavings: 800_000m);

    private static UserSettingsRequest ValidRequest() => new(Version: 2, Settings: ValidSettings());

    [Fact]
    public void Valid_ReturnsNull()
    {
        ValidRequest().Validate().Should().BeNull();
    }

    [Fact]
    public void SalaryNull_IsValid()
    {
        (ValidRequest() with { Settings = ValidSettings() with { Salary = null } })
            .Validate().Should().BeNull();
    }

    [Fact]
    public void Version1_IsValid()
    {
        (ValidRequest() with { Version = 1 }).Validate().Should().BeNull();
    }

    [Fact]
    public void Version2_IsValid()
    {
        (ValidRequest() with { Version = 2 }).Validate().Should().BeNull();
    }

    [Fact]
    public void Version3_ReturnsError()
    {
        (ValidRequest() with { Version = 3 }).Validate().Should().Be("Неподдерживаемая версия настроек");
    }

    [Fact]
    public void SettingsNull_ReturnsError()
    {
        (ValidRequest() with { Settings = null }).Validate().Should().Be("Настройки обязательны");
    }

    [Fact]
    public void SalaryBelowRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { Salary = -1 } })
            .Validate().Should().Be("Зарплата должна быть от 0 до 10 000 000");
    }

    [Fact]
    public void SalaryAboveRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { Salary = 10_000_001m } })
            .Validate().Should().Be("Зарплата должна быть от 0 до 10 000 000");
    }

    [Fact]
    public void DepositRateBelowRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { DepositRate = -0.1m } })
            .Validate().Should().Be("Доходность должна быть от 0 до 100 процентов");
    }

    [Fact]
    public void DepositRateAboveRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { DepositRate = 100.1m } })
            .Validate().Should().Be("Доходность должна быть от 0 до 100 процентов");
    }

    [Fact]
    public void FreeMonthlyBelowRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { FreeMonthly = -1 } })
            .Validate().Should().Be("Бюджет должен быть от 0 до 50 000 000");
    }

    [Fact]
    public void FreeMonthlyAboveRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { FreeMonthly = 50_000_001m } })
            .Validate().Should().Be("Бюджет должен быть от 0 до 50 000 000");
    }

    [Fact]
    public void HorizonYearsBelowRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { HorizonYears = 0 } })
            .Validate().Should().Be("Горизонт должен быть от 1 до 30 лет");
    }

    [Fact]
    public void HorizonYearsAboveRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { HorizonYears = 31 } })
            .Validate().Should().Be("Горизонт должен быть от 1 до 30 лет");
    }

    [Fact]
    public void KeyRateBelowRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { KeyRate = -0.1m } })
            .Validate().Should().Be("Ключевая ставка должна быть от 0 до 100 процентов");
    }

    [Fact]
    public void KeyRateAboveRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { KeyRate = 100.1m } })
            .Validate().Should().Be("Ключевая ставка должна быть от 0 до 100 процентов");
    }

    [Fact]
    public void BankDiscountBelowRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { BankDiscount = -10.1m } })
            .Validate().Should().Be("Дисконт банка должен быть от -10 до 10");
    }

    [Fact]
    public void BankDiscountAboveRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { BankDiscount = 10.1m } })
            .Validate().Should().Be("Дисконт банка должен быть от -10 до 10");
    }

    [Fact]
    public void BankDiscountAtBounds_IsValid()
    {
        (ValidRequest() with { Settings = ValidSettings() with { BankDiscount = -10m } })
            .Validate().Should().BeNull();
        (ValidRequest() with { Settings = ValidSettings() with { BankDiscount = 10m } })
            .Validate().Should().BeNull();
    }

    [Fact]
    public void StartingSavingsNull_IsValid()
    {
        (ValidRequest() with { Settings = ValidSettings() with { StartingSavings = null } })
            .Validate().Should().BeNull();
    }

    [Fact]
    public void StartingSavingsBelowRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { StartingSavings = -1 } })
            .Validate().Should().Be("Накопления должны быть от 0 до 100 000 000");
    }

    [Fact]
    public void StartingSavingsAboveRange_ReturnsError()
    {
        (ValidRequest() with { Settings = ValidSettings() with { StartingSavings = 100_000_001m } })
            .Validate().Should().Be("Накопления должны быть от 0 до 100 000 000");
    }

    [Fact]
    public void StartingSavingsAtBounds_IsValid()
    {
        (ValidRequest() with { Settings = ValidSettings() with { StartingSavings = 0 } })
            .Validate().Should().BeNull();
        (ValidRequest() with { Settings = ValidSettings() with { StartingSavings = 100_000_000m } })
            .Validate().Should().BeNull();
    }
}
