using System.Text.Json.Serialization;
using CreditCalc.Api.Auth;
using CreditCalc.Api.Data;
using CreditCalc.Api.Endpoints;
using CreditCalc.Api.Middleware;
using Mvv42.Auth.Client;
using Prometheus;

// Метрики (spec mvv42-infra-mon 2026-10-16-app-metrics): процесс и рантайм .NET — да,
// EventCounters и адаптер .NET Meters — нет (лишние серии). До создания любых метрик.
Metrics.SuppressDefaultMetrics(new SuppressDefaultMetricOptions { SuppressEventCounters = true, SuppressMeters = true });

var builder = WebApplication.CreateBuilder(args);

// /metrics — только на отдельном KestrelMetricServer (порт 9091 внутри контейнера, наружу —
// 127.0.0.1:9581). Основной порт 8080 (и nginx фронта, проксирующий /credit_calc/api/) метрики не отдаёт.
// Metrics:Port = 0 выключает сервер (тестовые хосты не делят порт).
var metricsPort = builder.Configuration.GetValue("Metrics:Port", 9091);
if (metricsPort > 0)
    builder.Services.AddMetricServer(o => o.Port = (ushort)metricsPort);

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
builder.Services.AddScoped<UserSettingsRepository>();
builder.Services.AddScoped<IUserStore>(sp => sp.GetRequiredService<UserRepository>());

// MigrationRunner резолвится (и, значит, читает ConnectionStrings:DefaultConnection) только
// когда Program.cs явно запрашивает его ниже — в Testing-окружении этого не происходит,
// поэтому смоук-тесты не требуют настоящей БД.
builder.Services.AddSingleton(sp => new MigrationRunner(
    sp.GetRequiredService<IConfiguration>().GetConnectionString("DefaultConnection")
        ?? throw new InvalidOperationException("ConnectionStrings:DefaultConnection не настроена"),
    sp.GetRequiredService<ILogger<MigrationRunner>>()));

// Аутентификация — только общий mvv42-auth: ES256 access-JWT из cookie, ключи из JWKS по docker-сети
// (sdk/dotnet/Mvv42Auth.cs, copy-in). Схема mvv42 — схема по умолчанию; FallbackPolicy = политика SDK
// (аутентифицирован И credit_calc ∈ apps или adm) — новые маршруты защищены по умолчанию.
// Локальный пользователь — по claim tg через ICurrentUser (spec §10.12), sub не используется.
builder.Services.AddAuthentication(Mvv42Auth.Scheme);
builder.Services.AddMvv42Auth(Mvv42App.Id, o => builder.Configuration.GetSection("Mvv42Auth").Bind(o));
builder.Services.AddAuthorization(options => options.FallbackPolicy = options.GetPolicy(Mvv42Auth.Policy));

builder.Services.AddHttpContextAccessor();
builder.Services.AddMemoryCache();
builder.Services.AddScoped<UserProvisioning>();
builder.Services.AddScoped<ICurrentUser, CurrentUser>();

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

// Swagger (только Development) — до аутентификации: FallbackPolicy применяется и к запросам без эндпоинта.
if (app.Environment.IsDevelopment())
{
    app.UseSwagger();
    app.UseSwaggerUI(c => c.SwaggerEndpoint("/swagger/v1/swagger.json", "CreditCalc API v1"));
}

// Явный UseRouting, чтобы UseHttpMetrics видел выбранный эндпоинт: метка endpoint = шаблон
// маршрута (/api/mortgages/{id}), а не сырой путь; коды — 2xx/4xx/5xx.
app.UseRouting();
app.UseHttpMetrics(o => o.ReduceStatusCodeCardinality());

app.UseCors();
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

app.MapMortgageEndpoints();
app.MapProfileEndpoints();

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
