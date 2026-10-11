namespace CreditCalc.Api.Auth;

/// <summary>
/// Стартовая проверка Jwt:Secret: вне Development/Testing сервис не должен подниматься
/// с пустым, коротким или закоммиченным в appsettings.json dev-секретом — иначе любой,
/// кто читал репозиторий, может подписать себе валидный JWT.
/// </summary>
public static class JwtSecretGuard
{
    /// <summary>Значение из appsettings.json — допустимо только для локальной разработки.</summary>
    public const string CommittedDevSecret = "dev-only-secret-key-do-not-use-in-prod-32chars";

    public const int MinLength = 32;

    /// <summary>
    /// Dev-секреты, когда-либо закоммиченные в appsettings.json проектов cashpulse / bonds / credit_calc.
    /// Любой из них (а также любое значение, содержащее "dev-secret") в проде запрещён.
    /// </summary>
    public static readonly string[] KnownDevSecrets =
    [
        "dev-secret-change-in-production-min-32-chars!!",
        "dev-secret-change-me-min-32-characters!!",
        "dev-only-secret-key-do-not-use-in-prod-32chars",
    ];

    public static bool IsKnownDevSecret(string secret) =>
        KnownDevSecrets.Contains(secret, StringComparer.Ordinal)
        || secret.Contains("dev-secret", StringComparison.OrdinalIgnoreCase);

    public static void Validate(IHostEnvironment env, string? secret)
    {
        if (env.IsDevelopment() || env.IsEnvironment("Testing"))
            return;

        if (string.IsNullOrWhiteSpace(secret)
            || secret.Length < MinLength
            || IsKnownDevSecret(secret))
        {
            throw new InvalidOperationException(
                $"Jwt:Secret must be configured with a non-default value of at least {MinLength} characters " +
                $"outside Development/Testing (environment: {env.EnvironmentName}). Set Jwt__Secret.");
        }
    }
}
