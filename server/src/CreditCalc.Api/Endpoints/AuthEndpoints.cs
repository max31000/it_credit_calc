using System.Security.Claims;
using CreditCalc.Api.Auth;
using CreditCalc.Api.Contracts;
using CreditCalc.Api.Data;
using Microsoft.AspNetCore.Authorization;

namespace CreditCalc.Api.Endpoints;

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/telegram", TelegramLogin).AllowAnonymous();
        // GET /api/auth/me защищён FallbackPolicy (RequireAuthenticatedUser) по умолчанию —
        // явного .RequireAuthorization() не нужно.
        app.MapGet("/api/auth/me", Me);
    }

    /// <summary>
    /// Принимает данные от Telegram Login Widget, проверяет подпись, создаёт/обновляет
    /// пользователя в <c>users</c> и возвращает JWT. Без allowlist (spec §3.1) —
    /// любой пользователь Telegram может войти и завести свои ипотеки.
    /// </summary>
    private static async Task<IResult> TelegramLogin(
        TelegramAuthData data,
        TelegramAuthService telegramAuth,
        UserRepository userRepo,
        JwtIssuer jwtIssuer)
    {
        if (!telegramAuth.ValidateAuthData(data))
        {
            return Results.Json(
                new { error = "Недействительные данные авторизации Telegram" },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var user = await userRepo.GetByTelegramIdAsync(data.Id);
        if (user is null)
        {
            user = new User
            {
                TelegramId = data.Id,
                Username = data.Username,
                FirstName = data.FirstName,
                LastName = data.LastName,
                PhotoUrl = data.PhotoUrl,
            };
            var newId = await userRepo.CreateAsync(user);
            user.Id = newId;
        }
        else
        {
            user.Username = data.Username;
            user.FirstName = data.FirstName;
            user.LastName = data.LastName;
            user.PhotoUrl = data.PhotoUrl;
            await userRepo.UpdateAsync(user);
        }

        var token = jwtIssuer.Issue(user);
        return Results.Ok(new AuthResponseDto(token, ToDto(user)));
    }

    private static async Task<IResult> Me(ClaimsPrincipal principal, UserRepository userRepo)
    {
        var userId = JwtIssuer.GetUserId(principal);
        if (userId is null)
            return Results.Json(new { error = "Требуется авторизация" }, statusCode: StatusCodes.Status401Unauthorized);

        var user = await userRepo.GetByIdAsync(userId.Value);
        if (user is null)
            return Results.Json(new { error = "Требуется авторизация" }, statusCode: StatusCodes.Status401Unauthorized);

        return Results.Ok(ToDto(user));
    }

    private static AuthUserDto ToDto(User user) =>
        new(user.Id, user.TelegramId, user.Username, user.FirstName, user.LastName);
}
