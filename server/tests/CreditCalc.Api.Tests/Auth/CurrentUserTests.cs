using CreditCalc.Api.Auth;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Caching.Memory;
using Mvv42.Auth.Client;

namespace CreditCalc.Api.Tests.Auth;

/// <summary>Провижининг локального пользователя по claim tg (spec §10.12): sub не используется никогда.</summary>
public class CurrentUserTests
{
    private static Mvv42User Me(long tg, string name = "Max V") => new("999", tg, name, false);

    private static CurrentUser CurrentUserFor(FakeUserStore store, long tg, string sub, IMemoryCache? cache = null)
    {
        var accessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = ClaimsPrincipals.Mvv42(tg, sub) } };
        return new CurrentUser(accessor, new UserProvisioning(store), cache ?? new MemoryCache(new MemoryCacheOptions()));
    }

    [Fact]
    public async Task ExistingUser_IsFoundByTelegramId_NotBySub()
    {
        var store = new FakeUserStore();
        store.Seed(telegramId: 343631124, id: 1);

        var id = await CurrentUserFor(store, 343631124, sub: "42").GetLocalUserIdAsync();

        id.Should().Be(1UL);
        store.Creates.Should().Be(0);
    }

    [Fact]
    public async Task SubEqualToAnotherLocalId_DoesNotLeakThatUsersData()
    {
        var store = new FakeUserStore();
        store.Seed(telegramId: 111, id: 7); // локальный пользователь с id = 7
        store.Seed(telegramId: 222, id: 8);

        // токен пользователя tg=222, у которого auth-id (sub) случайно = 7
        var id = await CurrentUserFor(store, 222, sub: "7").GetLocalUserIdAsync();

        id.Should().Be(8UL);
    }

    [Fact]
    public async Task NewUser_IsCreatedWithTelegramIdAndName()
    {
        var store = new FakeUserStore();

        var id = await CurrentUserFor(store, 5555, sub: "1").GetLocalUserIdAsync();

        var user = store.All.Should().ContainSingle().Subject;
        user.Id.Should().Be(id);
        user.TelegramId.Should().Be(5555);
        user.FirstName.Should().Be("Max V");
        id.Should().NotBe(1UL);
    }

    [Fact]
    public async Task DuplicateKeyOnInsert_RereadsTheRowCreatedByTheOtherRequest()
    {
        var store = new FakeUserStore { SimulateDuplicateOnce = true };

        var id = await new UserProvisioning(store).GetOrCreateAsync(Me(6666));

        store.All.Should().ContainSingle(u => u.TelegramId == 6666).Which.Id.Should().Be(id);
        store.Creates.Should().Be(1);
    }

    [Fact]
    public async Task ParallelFirstRequests_CreateOneRow()
    {
        var store = new FakeUserStore();
        var provisioning = new UserProvisioning(store);

        var ids = await Task.WhenAll(Enumerable.Range(0, 20).Select(_ => Task.Run(() => provisioning.GetOrCreateAsync(Me(7777)))));

        ids.Distinct().Should().ContainSingle();
        store.All.Should().ContainSingle();
        store.Creates.Should().Be(1);
    }

    [Fact]
    public async Task ChangedName_IsRefreshed_SameName_IsNotWritten()
    {
        var store = new FakeUserStore();
        var user = store.Seed(telegramId: 4242, id: 3);
        user.FirstName = "Old Name";
        var provisioning = new UserProvisioning(store);

        await provisioning.GetOrCreateAsync(Me(4242, "Max V"));
        await provisioning.GetOrCreateAsync(Me(4242, "Max V"));

        store.NameUpdates.Should().ContainSingle().Which.Should().Be((3UL, "Max V"));
    }

    [Fact]
    public async Task Invalidate_DropsCachedId()
    {
        var store = new FakeUserStore();
        var cache = new MemoryCache(new MemoryCacheOptions());
        store.Seed(telegramId: 5151, id: 9);
        var current = CurrentUserFor(store, 5151, "1", cache);
        (await current.GetLocalUserIdAsync()).Should().Be(9UL);

        store.Seed(telegramId: 5151, id: 10); // строку пересоздали (например, удалили руками)
        current.Invalidate();

        (await CurrentUserFor(store, 5151, "1", cache).GetLocalUserIdAsync()).Should().Be(10UL);
    }

    [Fact]
    public async Task LongName_IsTruncatedToColumnSize()
    {
        var store = new FakeUserStore();

        await new UserProvisioning(store).GetOrCreateAsync(Me(8888, new string('я', 300)));

        store.All.Single().FirstName.Should().HaveLength(255);
    }

    [Fact]
    public async Task ResolvedId_IsCachedAcrossRequests()
    {
        var store = new FakeUserStore();
        var cache = new MemoryCache(new MemoryCacheOptions());

        var first = await CurrentUserFor(store, 9999, "1", cache).GetLocalUserIdAsync();
        var lookups = store.Lookups.Count;
        var second = await CurrentUserFor(store, 9999, "1", cache).GetLocalUserIdAsync();

        second.Should().Be(first);
        store.Lookups.Count.Should().Be(lookups);
    }

    [Fact]
    public async Task NotMvv42Authenticated_Throws()
    {
        var accessor = new HttpContextAccessor { HttpContext = new DefaultHttpContext() };
        var currentUser = new CurrentUser(accessor, new UserProvisioning(new FakeUserStore()), new MemoryCache(new MemoryCacheOptions()));

        await currentUser.Invoking(c => c.GetLocalUserIdAsync()).Should().ThrowAsync<InvalidOperationException>();
    }
}
