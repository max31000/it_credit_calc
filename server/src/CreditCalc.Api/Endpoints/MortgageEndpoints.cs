using CreditCalc.Api.Auth;
using CreditCalc.Api.Contracts;
using CreditCalc.Api.Data;

namespace CreditCalc.Api.Endpoints;

/// <summary>
/// Девять защищённых маршрутов ипотек/событий из spec §3.2. Проверка владения не дублируется
/// здесь в коде — она уже сделана в SQL репозиториев (userId в каждом запросе); эндпоинты лишь
/// превращают <c>null</c>/<c>false</c> от репозитория в 404.
/// </summary>
public static class MortgageEndpoints
{
    public static void MapMortgageEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/mortgages");

        group.MapGet("", ListMortgages);
        group.MapPost("", CreateMortgage);
        group.MapGet("/{id}", GetMortgage);
        group.MapPut("/{id}", UpdateMortgage);
        group.MapDelete("/{id}", DeleteMortgage);
        group.MapGet("/{id}/events", ListEvents);
        group.MapPost("/{id}/events", CreateEvent);
        group.MapDelete("/{id}/events/{eventId}", DeleteEvent);
    }

    /// <summary>
    /// Отдаёт ипотеки вместе с событиями (spec §4.2, ломающее изменение контракта) —
    /// два запроса вместо N+1: один за ипотеками, один за всеми событиями пользователя,
    /// группировка <c>ToLookup</c> в памяти. Порядок ипотек прежний, событий — occurred_on ASC, id ASC.
    /// </summary>
    private static async Task<IResult> ListMortgages(
        ICurrentUser currentUser, MortgageRepository mortgageRepo, MortgageEventRepository eventRepo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();

        var mortgages = await mortgageRepo.ListAsync(userId);
        var events = await eventRepo.ListAllByUserAsync(userId);
        var eventsByMortgage = events.ToLookup(e => e.MortgageId);

        var result = mortgages.Select(m =>
            new MortgageDetailsDto(ToDto(m), eventsByMortgage[m.Id].Select(ToDto).ToList()));

        return Results.Ok(result);
    }

    private static async Task<IResult> CreateMortgage(ICurrentUser currentUser, MortgageRequest request, MortgageRepository repo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();

        var error = request.Validate();
        if (error is not null)
            return Results.BadRequest(new { error });

        var id = await repo.CreateAsync(userId, request);
        var created = await repo.GetAsync(userId, id);
        return Results.Created($"/api/mortgages/{id}", ToDto(created!));
    }

    private static async Task<IResult> GetMortgage(
        ICurrentUser currentUser, ulong id, MortgageRepository mortgageRepo, MortgageEventRepository eventRepo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();

        var mortgage = await mortgageRepo.GetAsync(userId, id);
        if (mortgage is null)
            return MortgageNotFound();

        var events = await eventRepo.ListAsync(userId, id) ?? [];
        return Results.Ok(new MortgageDetailsDto(ToDto(mortgage), events.Select(ToDto).ToList()));
    }

    private static async Task<IResult> UpdateMortgage(
        ICurrentUser currentUser, ulong id, MortgageRequest request, MortgageRepository repo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();

        var error = request.Validate();
        if (error is not null)
            return Results.BadRequest(new { error });

        var updated = await repo.UpdateAsync(userId, id, request);
        if (updated is null)
            return MortgageNotFound();

        return Results.Ok(ToDto(updated));
    }

    private static async Task<IResult> DeleteMortgage(ICurrentUser currentUser, ulong id, MortgageRepository repo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();
        var deleted = await repo.DeleteAsync(userId, id);
        return deleted ? Results.NoContent() : MortgageNotFound();
    }

    private static async Task<IResult> ListEvents(ICurrentUser currentUser, ulong id, MortgageEventRepository repo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();
        var events = await repo.ListAsync(userId, id);
        if (events is null)
            return MortgageNotFound();

        return Results.Ok(events.Select(ToDto));
    }

    private static async Task<IResult> CreateEvent(
        ICurrentUser currentUser,
        ulong id,
        MortgageEventRequest request,
        MortgageRepository mortgageRepo,
        MortgageEventRepository eventRepo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();

        var mortgage = await mortgageRepo.GetAsync(userId, id);
        if (mortgage is null)
            return MortgageNotFound();

        var error = request.Validate(mortgage.StartedOn);
        if (error is not null)
            return Results.BadRequest(new { error });

        var created = await eventRepo.CreateAsync(userId, id, request);
        if (created is null)
            return MortgageNotFound();

        return Results.Created($"/api/mortgages/{id}/events/{created.Id}", ToDto(created));
    }

    private static async Task<IResult> DeleteEvent(ICurrentUser currentUser, ulong id, ulong eventId, MortgageEventRepository repo)
    {
        var userId = await currentUser.GetLocalUserIdAsync();
        var deleted = await repo.DeleteAsync(userId, id, eventId);
        return deleted
            ? Results.NoContent()
            : Results.Json(new { error = "Событие не найдено" }, statusCode: StatusCodes.Status404NotFound);
    }

    private static IResult MortgageNotFound() =>
        Results.Json(new { error = "Ипотека не найдена" }, statusCode: StatusCodes.Status404NotFound);

    private static MortgageDto ToDto(Mortgage m) => new(
        m.Id, m.Title, m.Bank, m.PropertyPrice, m.DownPayment, m.Principal, m.Rate,
        m.TermMonths, m.StartedOn, m.MonthlyPayment,
        DateTime.SpecifyKind(m.CreatedAt, DateTimeKind.Utc),
        DateTime.SpecifyKind(m.UpdatedAt, DateTimeKind.Utc),
        m.UsedPropertyBase, m.UsedInterestBase);

    private static MortgageEventDto ToDto(MortgageEvent e) => new(
        e.Id, e.MortgageId, e.Kind, e.OccurredOn, e.Amount, e.Rate, e.Note,
        DateTime.SpecifyKind(e.CreatedAt, DateTimeKind.Utc));
}
