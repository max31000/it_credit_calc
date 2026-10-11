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

    public static void Validate(IHostEnvironment env, string? secret)
    {
        if (env.IsDevelopment() || env.IsEnvironment("Testing"))
            return;

        if (string.IsNullOrWhiteSpace(secret)
            || secret.Length < MinLength
            || secret == CommittedDevSecret)
        {
            throw new InvalidOperationException(
                $"Jwt:Secret must be configured with a non-default value of at least {MinLength} characters " +
                $"outside Development/Testing (environment: {env.EnvironmentName}). Set Jwt__Secret.");
        }
    }
}
