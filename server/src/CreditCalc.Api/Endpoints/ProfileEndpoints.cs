using System.Security.Claims;
using CreditCalc.Api.Auth;
using CreditCalc.Api.Contracts;
using CreditCalc.Api.Data;

namespace CreditCalc.Api.Endpoints;

/// <summary>
/// GET/PUT /api/profile/settings — шесть настроек аккаунта одной строкой на пользователя
/// (spec §4.1, §5.2). Защищён через <c>FallbackPolicy</c> (явный <c>RequireAuthorization()</c>
/// не нужен). userId — только из <see cref="ClaimsPrincipal"/>; чужие настройки недостижимы,
/// ключ в SQL — <c>user_id</c> из JWT.
/// </summary>
public static class ProfileEndpoints
{
    public static void MapProfileEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/profile");

        group.MapGet("/settings", GetSettings);
        group.MapPut("/settings", PutSettings);
    }

    private static async Task<IResult> GetSettings(ClaimsPrincipal principal, UserSettingsRepository repo)
    {
        var userId = RequireUserId(principal);
        var row = await repo.GetAsync(userId);
        return Results.Ok(ToResponse(row, repo));
    }

    private static async Task<IResult> PutSettings(
        ClaimsPrincipal principal, UserSettingsRequest request, UserSettingsRepository repo)
    {
        var userId = RequireUserId(principal);

        var error = request.Validate();
        if (error is not null)
            return Results.BadRequest(new { error });

        var json = UserSettingsRepository.Serialize(request.Settings!);
        var row = await repo.UpsertAsync(userId, request.Version, json);
        return Results.Ok(ToResponse(row, repo));
    }

    /// <summary>
    /// Строки нет (пользователь ещё не сохранял) → <c>200 { version: 2, settings: null, updatedAt: null }</c>,
    /// не 404. Версия 2 — фронт всегда шлёт её (spec §7.1 mortgage-timeline-design).
    /// </summary>
    private static UserSettingsResponse ToResponse(UserSettingsRow? row, UserSettingsRepository repo)
    {
        if (row is null)
            return new UserSettingsResponse(2, null, null);

        var settings = repo.Deserialize(row.Data);
        // startingSavings в JSON-колонке nullable: строки, записанные версией 1 (без этого поля),
        // читаются как null и нормализуются в 0 при отдаче (spec §7.1) — миграция данных не нужна.
        if (settings is { StartingSavings: null })
            settings = settings with { StartingSavings = 0 };

        return new UserSettingsResponse(row.Version, settings, DateTime.SpecifyKind(row.UpdatedAt, DateTimeKind.Utc));
    }

    /// <summary>
    /// userId берётся только из ClaimsPrincipal (spec §5.5, как в MortgageEndpoints). FallbackPolicy
    /// гарантирует аутентификацию раньше вызова хендлера, поэтому claim здесь всегда присутствует —
    /// исключение не должно быть достижимо в проде, это защитная мера на случай ошибки конфигурации.
    /// </summary>
    private static ulong RequireUserId(ClaimsPrincipal principal) =>
        JwtIssuer.GetUserId(principal) ?? throw new InvalidOperationException("userId отсутствует в токене");
}
