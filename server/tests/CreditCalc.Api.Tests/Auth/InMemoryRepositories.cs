using System.Collections.Concurrent;
using CreditCalc.Api.Contracts;
using CreditCalc.Api.Data;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace CreditCalc.Api.Tests.Auth;

/// <summary>
/// In-memory репозитории с той же семантикой владения, что и SQL (фильтр по userId), — чтобы проверять
/// весь путь «cookie → политика → ICurrentUser → эндпоинт» без MySQL и без допуска 500 в тестах.
/// </summary>
internal static class InMemoryDb
{
    public static readonly Db Unused = new(new ConfigurationBuilder().Build());
}

public sealed class InMemoryMortgageRepository() : MortgageRepository(InMemoryDb.Unused)
{
    private readonly ConcurrentDictionary<ulong, Mortgage> _rows = new();
    private long _nextId;

    public Mortgage? Find(ulong id) => _rows.GetValueOrDefault(id);

    public override Task<IReadOnlyList<Mortgage>> ListAsync(ulong userId) =>
        Task.FromResult<IReadOnlyList<Mortgage>>(_rows.Values.Where(m => m.UserId == userId)
            .OrderByDescending(m => m.StartedOn).ThenByDescending(m => m.Id).ToList());

    public override Task<Mortgage?> GetAsync(ulong userId, ulong id) =>
        Task.FromResult(_rows.TryGetValue(id, out var m) && m.UserId == userId ? m : null);

    public override Task<ulong> CreateAsync(ulong userId, MortgageRequest r)
    {
        var id = (ulong)Interlocked.Increment(ref _nextId);
        _rows[id] = Apply(new Mortgage { Id = id, UserId = userId, CreatedAt = DateTime.UtcNow }, r);
        return Task.FromResult(id);
    }

    public override async Task<Mortgage?> UpdateAsync(ulong userId, ulong id, MortgageRequest r) =>
        await GetAsync(userId, id) is { } m ? Apply(m, r) : null;

    public override Task<bool> DeleteAsync(ulong userId, ulong id) =>
        Task.FromResult(_rows.TryGetValue(id, out var m) && m.UserId == userId && _rows.TryRemove(id, out _));

    private static Mortgage Apply(Mortgage m, MortgageRequest r)
    {
        m.Title = r.Title; m.Bank = r.Bank; m.PropertyPrice = r.PropertyPrice; m.DownPayment = r.DownPayment;
        m.Principal = r.Principal; m.Rate = r.Rate; m.TermMonths = r.TermMonths; m.StartedOn = r.StartedOn;
        m.MonthlyPayment = r.MonthlyPayment; m.UsedPropertyBase = r.UsedPropertyBase; m.UsedInterestBase = r.UsedInterestBase;
        m.UpdatedAt = DateTime.UtcNow;
        return m;
    }
}

public sealed class InMemoryMortgageEventRepository(InMemoryMortgageRepository mortgages) : MortgageEventRepository(InMemoryDb.Unused)
{
    private readonly ConcurrentDictionary<ulong, MortgageEvent> _rows = new();
    private long _nextId;

    private bool Owns(ulong userId, ulong mortgageId) => mortgages.Find(mortgageId)?.UserId == userId;

    public override Task<IReadOnlyList<MortgageEvent>> ListAllByUserAsync(ulong userId) =>
        Task.FromResult<IReadOnlyList<MortgageEvent>>(_rows.Values.Where(e => Owns(userId, e.MortgageId))
            .OrderBy(e => e.OccurredOn).ThenBy(e => e.Id).ToList());

    public override Task<IReadOnlyList<MortgageEvent>?> ListAsync(ulong userId, ulong mortgageId) =>
        Task.FromResult<IReadOnlyList<MortgageEvent>?>(Owns(userId, mortgageId)
            ? _rows.Values.Where(e => e.MortgageId == mortgageId).OrderBy(e => e.OccurredOn).ThenBy(e => e.Id).ToList()
            : null);

    public override Task<MortgageEvent?> CreateAsync(ulong userId, ulong mortgageId, MortgageEventRequest r)
    {
        if (!Owns(userId, mortgageId)) return Task.FromResult<MortgageEvent?>(null);
        var id = (ulong)Interlocked.Increment(ref _nextId);
        var e = new MortgageEvent
        {
            Id = id, MortgageId = mortgageId, Kind = r.Kind, OccurredOn = r.OccurredOn, Amount = r.Amount,
            Rate = r.Rate, Note = r.Note, CreatedAt = DateTime.UtcNow,
        };
        _rows[id] = e;
        return Task.FromResult<MortgageEvent?>(e);
    }

    public override Task<bool> DeleteAsync(ulong userId, ulong mortgageId, ulong eventId) =>
        Task.FromResult(Owns(userId, mortgageId) && _rows.TryGetValue(eventId, out var e) && e.MortgageId == mortgageId
                        && _rows.TryRemove(eventId, out _));
}

public sealed class InMemoryUserSettingsRepository()
    : UserSettingsRepository(InMemoryDb.Unused, NullLogger<UserSettingsRepository>.Instance)
{
    private readonly ConcurrentDictionary<ulong, UserSettingsRow> _rows = new();

    public override Task<UserSettingsRow?> GetAsync(ulong userId) => Task.FromResult(_rows.GetValueOrDefault(userId));

    public override Task<UserSettingsRow> UpsertAsync(ulong userId, int version, string dataJson)
    {
        var row = new UserSettingsRow { UserId = userId, Version = version, Data = dataJson, UpdatedAt = DateTime.UtcNow };
        _rows[userId] = row;
        return Task.FromResult(row);
    }
}
