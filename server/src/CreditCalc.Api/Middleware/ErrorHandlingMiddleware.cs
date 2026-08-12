using System.Text.Json;

namespace CreditCalc.Api.Middleware;

/// <summary>
/// Единый формат ошибок для необработанных исключений (spec §3: "Ошибка всегда
/// <c>{ "error": "текст на русском" }</c>"). Регистрируется первым в конвейере, чтобы
/// оборачивать весь остальной pipeline. Ожидаемые 400/404 формируются самими эндпоинтами —
/// сюда попадают только непредвиденные сбои.
/// </summary>
public class ErrorHandlingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ErrorHandlingMiddleware> _logger;

    public ErrorHandlingMiddleware(RequestDelegate next, ILogger<ErrorHandlingMiddleware> logger)
    {
        _next = next;
        _logger = logger;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unhandled exception");

            context.Response.StatusCode = StatusCodes.Status500InternalServerError;
            context.Response.ContentType = "application/json";

            var json = JsonSerializer.Serialize(
                new { error = "Внутренняя ошибка" },
                new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

            await context.Response.WriteAsync(json);
        }
    }
}
