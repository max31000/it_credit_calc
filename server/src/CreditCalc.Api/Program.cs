using System.Text;
using System.Text.Json.Serialization;
using CreditCalc.Api.Auth;
using CreditCalc.Api.Data;
using CreditCalc.Api.Endpoints;
using CreditCalc.Api.Middleware;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

var builder = WebApplication.CreateBuilder(args);

// CORS — по умолчанию нужен только фронту в dev-режиме (Vite на 5173) при обходе прокси;
// в проде фронт и API — один origin (nginx срезает /credit_calc/api), CORS не участвует (spec §4).
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>()
            ?? ["http://localhost:5173"];
        policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
    });
});

builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(c =>
{
    c.SwaggerDoc("v1", new() { Title = "CreditCalc API", Version = "v1" });
});

// Данные/домен
builder.Services.AddSingleton<Db>();
builder.Services.AddScoped<UserRepository>();
builder.Services.AddScoped<MortgageRepository>();
builder.Services.AddScoped<MortgageEventRepository>();
builder.Services.AddScoped<TelegramAuthService>();
builder.Services.AddScoped<JwtIssuer>();

// MigrationRunner резолвится (и, значит, читает ConnectionStrings:DefaultConnection) только
// когда Program.cs явно запрашивает его ниже — в Testing-окружении этого не происходит,
// поэтому смоук-тесты не требуют настоящей БД.
builder.Services.AddSingleton(sp => new MigrationRunner(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")
        ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection не настроена"),
    sp.GetRequiredService<ILogger<MigrationRunner>>()));

// JWT-авторизация. Jwt:Secret читается лениво через IConfigureOptions<JwtBearerOptions>
// (а не сразу из builder.Configuration на старте), чтобы WebApplicationFactory.ConfigureWebHost
// в тестах успела подменить секрет до первого запроса — паттерн из bonds/Bonds.Api/Program.cs.
builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer();

builder.Services.AddSingleton<IConfigureOptions<JwtBearerOptions>>(sp =>
    new ConfigureNamedOptions<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
    {
        var config = sp.GetRequiredService<IConfiguration>();
        var secret = config["Jwt:Secret"] ?? throw new InvalidOperationException("Jwt:Secret не настроен");

        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret)),
            ValidateIssuer = true,
            ValidIssuer = config["Jwt:Issuer"] ?? "credit_calc",
            ValidateAudience = true,
            ValidAudience = config["Jwt:Audience"] ?? "credit_calc",
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    }));

// Fallback-политика: всё, что явно не помечено [AllowAnonymous], требует Bearer-токен —
// новые маршруты защищены по умолчанию (spec §5.2).
builder.Services.AddAuthorization(options =>
{
    options.FallbackPolicy = new AuthorizationPolicyBuilder()
        .RequireAuthenticatedUser()
        .Build();
});

// JSON: camelCase + string enums (контракт для фронта, spec §3)
builder.Services.ConfigureHttpJsonOptions(options =>
{
    options.SerializerOptions.PropertyNamingPolicy = System.Text.Json.JsonNamingPolicy.CamelCase;
    options.SerializerOptions.PropertyNameCaseInsensitive = true;
    options.SerializerOptions.Converters.Add(
        new JsonStringEnumConverter(System.Text.Json.JsonNamingPolicy.CamelCase));
});

var app = builder.Build();

// Единый формат ошибок для необработанных исключений — должен оборачивать весь остальной
// конвейер, иначе исключения дальше по цепочке в него не попадут.
app.UseMiddleware<ErrorHandlingMiddleware>();

app.UseCors();

if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "CreditCalc API v1"));
}

app.UseAuthentication();
app.UseAuthorization();

// Миграции на старте — пропускаются в Testing (HealthSmokeTests работает без БД).
if (!app.Environment.IsEnvironment("Testing"))
{
    try
    {
        var migrationRunner = app.Services.GetRequiredService<MigrationRunner>();
        await migrationRunner.RunAsync();
    }
    catch (Exception ex)
    {
        app.Logger.LogError(ex, "Failed to run database migrations");
        throw;
    }
}

app.MapAuthEndpoints();
app.MapMortgageEndpoints();

// Health доступен по двум путям:
//   /health     — прямая проверка контейнера (docker healthcheck, `curl localhost:8080/health`);
//   /api/health — через nginx фронт-контейнера: он режет префикс /credit_calc, поэтому
//                 внешний GET /credit_calc/api/health приходит сюда как /api/health.
// Без второго маршрута health-гейт деплоя (`curl -sf .../credit_calc/api/health`) получает 401:
// FallbackPolicy применяется и к запросам без совпавшего эндпоинта.
var health = () => Results.Ok(new { status = "ok" });
app.MapGet("/health", health).AllowAnonymous();
app.MapGet("/api/health", health).AllowAnonymous();

// Несуществующие маршруты должны отдавать 404, а не 401 от FallbackPolicy
// (которая иначе применяется ко всем непокрытым маршрутам как к защищённым).
app.MapFallback(() => Results.Json(new { error = "Не найдено" }, statusCode: StatusCodes.Status404NotFound))
    .AllowAnonymous();

app.Run();

// Нужен для WebApplicationFactory<Program> в тестах.
public partial class Program { }
