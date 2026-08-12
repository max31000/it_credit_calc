# План: трекер → калькулятор, настройки в аккаунте, связанные поля, фикс ввода

Дата: 2026-08-12. Спека: `docs/specs/2026-08-12-tracker-ux-design.md`.
**§4 спеки (API-контракт) — единственный источник правды для A и B. Расхождение с ним = баг.**

Два исполнителя работают **параллельно**, зоны не пересекаются ни одним файлом.

| Кто | Владеет | Не трогает |
|-----|---------|-----------|
| **A** backend | `server/**` | `src/`, `docs/`, корневые конфиги, `.github/`, `deploy/` |
| **B** frontend | `src/**` | `server/`, `docs/`, `.github/`, `deploy/`, `nginx.conf`, `Dockerfile` |

Общие правила: комментарии и UI-тексты на русском; ничего не коммитить без прохождения
своих проверок; `docs/` править не нужно — спека уже написана.

Синхронизация: стартуют одновременно. Мерж — вместе, одним релизом:
`GET /api/mortgages` меняет формат (§4.2 спеки), выкатывать половину нельзя.

---

# Executor A — бэкенд (`server/**`)

## Файлы

Создать:
```
server/src/CreditCalc.Api/Data/Migrations/002_user_settings.sql
server/src/CreditCalc.Api/Data/UserSettingsRepository.cs
server/src/CreditCalc.Api/Endpoints/ProfileEndpoints.cs
server/tests/CreditCalc.Api.Tests/UserSettingsValidationTests.cs
```
Изменить:
```
server/src/CreditCalc.Api/Contracts/Dtos.cs           (+ UserSettingsDto, UserSettingsResponse)
server/src/CreditCalc.Api/Contracts/Requests.cs       (+ UserSettingsRequest.Validate())
server/src/CreditCalc.Api/Data/MortgageEventRepository.cs (+ ListAllByUserAsync)
server/src/CreditCalc.Api/Endpoints/MortgageEndpoints.cs  (ListMortgages → с событиями)
server/src/CreditCalc.Api/Program.cs                  (+ 2 регистрации DI, + MapProfileEndpoints)
```

## Шаги

### A1. Миграция 002

`Data/Migrations/002_user_settings.sql` — ровно DDL из §5.1 спеки.
`.csproj` менять не надо: `<EmbeddedResource Include="Data\Migrations\*.sql" />` уже есть.

Проверить, что `MigrationRunner.SplitSqlStatements` корректно разбивает файл: без `;`
внутри литералов, без хранимых процедур, `--`-комментарии допустимы.

### A2. Контракты настроек

`Contracts/Dtos.cs`:
```csharp
public record UserSettingsDto(
    decimal? Salary, decimal DepositRate, decimal FreeMonthly,
    int HorizonYears, decimal KeyRate, decimal BankDiscount);

/// <summary>Ответ GET/PUT /api/profile/settings. Settings = null — пользователь ещё не сохранял.</summary>
public record UserSettingsResponse(int Version, UserSettingsDto? Settings, DateTime? UpdatedAt);
```

`Contracts/Requests.cs`:
```csharp
public record UserSettingsRequest(int Version, UserSettingsDto? Settings)
{
    public string? Validate();   // тексты ошибок — таблица §4.1 спеки, дословно
}
```
Правила: `Version != 1` → `Неподдерживаемая версия настроек`; `Settings is null` → 400
(`Настройки обязательны`); далее шесть диапазонов из таблицы §4.1.

### A3. Репозиторий

`Data/UserSettingsRepository.cs` — по образцу `UserRepository` (`Db.Create()`, Dapper):
```csharp
public class UserSettingsRow
{
    public ulong UserId { get; set; }
    public int Version { get; set; }
    public string Data { get; set; } = "{}";
    public DateTime UpdatedAt { get; set; }
}

Task<UserSettingsRow?> GetAsync(ulong userId);
Task<UserSettingsRow> UpsertAsync(ulong userId, int version, string dataJson);
```
Upsert: `INSERT INTO user_settings (user_id, version, data) VALUES (@UserId, @Version, @Data)
ON DUPLICATE KEY UPDATE version = VALUES(version), data = VALUES(data)`, затем `GetAsync`.

Сериализация `UserSettingsDto` ↔ JSON — `JsonSerializer` с `PropertyNamingPolicy = CamelCase`
(вынести статический `JsonSerializerOptions` в репозиторий, не создавать на каждый вызов).
Битый JSON в колонке (руками поправили в БД) → лог `Warning` + вернуть `Settings = null`,
а не 500.

### A4. Эндпоинты профиля

`Endpoints/ProfileEndpoints.cs`:
```csharp
public static void MapProfileEndpoints(this WebApplication app)
{
    var group = app.MapGroup("/api/profile");
    group.MapGet("/settings", GetSettings);
    group.MapPut("/settings", PutSettings);
}
```
- `userId` — `JwtIssuer.GetUserId(principal)` (как в `MortgageEndpoints.RequireUserId`).
- Авторизация — через `FallbackPolicy`, `.RequireAuthorization()` не нужен.
- GET: строки нет → `200 { version: 1, settings: null, updatedAt: null }` (не 404).
- PUT: `Validate()` → 400 `{ error }`; иначе upsert → 200 с тем же телом, что у GET.

`Program.cs`: `builder.Services.AddScoped<UserSettingsRepository>();` и `app.MapProfileEndpoints();`
рядом с `app.MapMortgageEndpoints();`.

### A5. Список ипотек с событиями (§4.2)

`MortgageEventRepository`:
```csharp
/// <summary>Все события всех ипотек пользователя — один запрос вместо N.</summary>
public async Task<IReadOnlyList<MortgageEvent>> ListAllByUserAsync(ulong userId)
```
SQL:
```sql
SELECT e.* FROM mortgage_events e
JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId
ORDER BY e.occurred_on ASC, e.id ASC
```

`MortgageEndpoints.ListMortgages`: два запроса (ипотеки + все события), группировка
`ToLookup(e => e.MortgageId)` в памяти, ответ — `MortgageDetailsDto[]`.
Порядок ипотек прежний, порядок событий — `occurred_on ASC, id ASC`.
**Никаких N+1** — по одному запросу на каждую таблицу.

### A6. Тесты

`UserSettingsValidationTests.cs` (чистые юниты, БД не нужна — как `ValidationTests.cs`):
- валидный запрос → `Validate() == null`;
- `version = 2` → ошибка про версию;
- `settings = null` → ошибка;
- по одному кейсу выхода за границу на каждое из шести полей (обе границы для `bankDiscount`);
- `salary = null` — валидно.

Добавить в `MigrationRunnerTests`: `SplitSqlStatements` на содержимом `002_user_settings.sql`
возвращает ровно 1 statement.

## Критерии готовности A

- [ ] `GET /api/profile/settings` без сохранённых настроек → 200, `settings: null`.
- [ ] `PUT` валидного тела → 200, повторный `GET` возвращает то же самое.
- [ ] `PUT` с `version: 2` и с каждым выходом за диапазон → 400 с русским текстом из §4.1.
- [ ] Оба маршрута без `Authorization` → 401.
- [ ] Настройки чужого пользователя недостижимы (ключ — `user_id` из JWT, параметра нет).
- [ ] `GET /api/mortgages` → массив `{ mortgage, events }`; у ипотеки без событий `events: []`.
- [ ] Миграция 002 применяется на чистой БД и идемпотентна при повторном старте
      (запись в `_migrations`).
- [ ] `DELETE` пользователя каскадно удаляет `user_settings` (проверить FK вручную в SQL).

## Команды проверки A

```bash
dotnet restore server/CreditCalc.sln
dotnet build   server/CreditCalc.sln -c Release --no-restore
dotnet test    server/CreditCalc.sln -c Release --no-build
```
Ручная проверка против MySQL в docker (миграция + оба маршрута curl-ом с валидным JWT).

---

# Executor B — фронтенд (`src/**`)

## Файлы

Создать:
```
src/components/controls/NumericInput.tsx
src/lib/loanLink.ts
src/lib/mortgageToParams.ts
src/api/profile.ts
src/components/calculator/MortgageModeBanner.tsx
src/components/AccountSettingsSync.tsx
src/lib/__tests__/loanLink.test.ts
src/lib/__tests__/mortgageToParams.test.ts
src/components/controls/__tests__/NumericInput.test.tsx
```
Изменить:
```
src/api/types.ts                       (+ AccountSettings, UserSettingsResponse; listMortgages → MortgageDetails[])
src/api/mortgages.ts                   (listMortgages: MortgageDetails[])
src/store/useCalculatorStore.ts        (ownParams, linkedMortgage, режим, applyAccountSettings, setParams)
src/store/__tests__/useCalculatorStore.test.ts
src/pages/CalculatorPage.tsx           (баннер, актуализация из трекера, скрытие кнопки в режиме)
src/pages/MortgagePage.tsx             (кнопка «Открыть в калькуляторе»)
src/pages/TrackerListPage.tsx          (новый формат списка)
src/pages/LoginPage.tsx                (возврат на from)
src/components/ProtectedRoute.tsx      (state.from)
src/components/tracker/MortgageCard.tsx (принимает events, кнопка «Открыть в калькуляторе»)
src/components/tracker/MortgageForm.tsx (связанные поля + NumericInput)
src/components/tracker/EventForm.tsx    (NumericInput)
src/components/sections/ParamsSection.tsx (relinkLoan, NumericInput, inputMin у срока)
src/components/controls/SliderInput.tsx  (NumericInput, удалить commitInput)
src/App.tsx                            (<AccountSettingsSync /> в Shell)
```

## Шаги

Порядок важен: B1 → B2 разблокируют всё остальное.

### B1. `NumericInput` (жалоба 4, §7 спеки)

Реализовать по §7.2 дословно: локальный `draft` + `focused`, `clampBehavior="none"`,
живой коммит только валидного числа в диапазоне, клампинг на `blur`, `allowEmpty`.
Прокинуть пропсы, которые нужны текущим вызовам: `label`, `placeholder`, `description`,
`step`, `suffix`, `thousandSeparator`, `decimalScale`, `size`, `styles`, `hideControls`, `required`.

Тесты — четыре кейса §7.3.

Затем заменить `NumberInput` → `NumericInput` в `SliderInput` (удалив `commitInput` целиком),
`ParamsSection` (зарплата, `allowEmpty`), `MortgageForm`, `EventForm`.

Проверить руками сценарий из жалобы: поле `1 000 000`, курсор в начало, `Backspace` —
поле не очищается и не прыгает.

### B2. Стор: `ownParams` + режим ипотеки (§3.1)

- `ACCOUNT_SETTING_KEYS`, `LinkedMortgage`, поля `ownParams` / `linkedMortgage`.
- `setParam` по правилу записи из §3.1 (ключ аккаунта → в оба набора; сценарный ключ →
  в `ownParams` только вне режима ипотеки).
- Новый `setParams(patch: Partial<MortgageParams>)` — один пересчёт движка на батч
  (нужен для `relinkLoan`, который меняет два поля сразу).
- `enterMortgageMode(link, params)`, `exitMortgageMode()`, `applyAccountSettings(s)`.
- `persist`: `version: 3`, `partialize: { params, ownParams, slipEnabled, linkedMortgage }`,
  `migrate` при `v < 3` → `ownParams = params ?? defaultParams`, `linkedMortgage = null`.
  `onRehydrateStorage` дозаливает дефолты в **оба** набора.
- `enterMortgageMode` принудительно ставит `slipEnabled = false`.

Тесты стора (дополнить существующий файл):
- вход в режим не меняет `ownParams`; выход возвращает их точь-в-точь;
- правка `freeMonthly` в режиме ипотеки уходит и в `ownParams`;
- правка `apartmentPrice` в режиме ипотеки **не** уходит в `ownParams`;
- миграция persist v2 → v3 создаёт `ownParams`.

### B3. Маппинг ипотеки в параметры (§2)

`src/lib/mortgageToParams.ts` — чистая функция по таблице §2, включая допущения 4 и 5
(`termFallback`, клампы). Никакого `new Date()` внутри — `today` в аргументах,
как в `tracker.ts`.

Тесты: ипотека без событий; с `balance`-событием; с `rate`-событием (ставка меняется);
`monthsLeft === null` → `termFallback === true`; закрытая ипотека (`currentBalance === 0`);
инвариант `apartmentPrice − downPayment === round(currentBalance)`.

### B4. API-клиент

`src/api/types.ts`:
```ts
export interface AccountSettings {
  salary: number | null
  depositRate: number
  freeMonthly: number
  horizonYears: number
  keyRate: number
  bankDiscount: number
}
export interface UserSettingsResponse {
  version: number
  settings: AccountSettings | null
  updatedAt: string | null
}
```
`src/api/profile.ts`:
```ts
export const getSettings = () => apiClient.get<UserSettingsResponse>('/profile/settings')
export const putSettings = (settings: AccountSettings) =>
  apiClient.put<UserSettingsResponse>('/profile/settings', { version: 1, settings })
```
`src/api/mortgages.ts`: `listMortgages(): Promise<MortgageDetails[]>` (§4.2).

### B5. Синхронизация настроек (§5.3)

`src/components/AccountSettingsSync.tsx` — компонент без разметки (`return null`),
монтируется в `Shell` в `src/App.tsx`. Логика ровно из §5.3:
- гейт `TRACKER_ENABLED && isAuthenticated` (иначе ни одного запроса — G12);
- на смену `user.id`: `exitMortgageMode()` (если id сменился), затем `GET` →
  `settings === null` ? сеять `PUT` из `ownParams` : `applyAccountSettings(server)`;
- подписка на стор, дебаунс 800 мс, `PUT` при изменении любого из шести ключей;
- флаг `loaded` — до успешного `GET` никаких `PUT`;
- ретраи: `GET` через 5 с, `PUT` через 3 с, затем `notification` один раз за сессию.

`Header.handleLogout` дополнительно вызывает `exitMortgageMode()`.

### B6. Режим ипотеки в UI (§3.2–3.4)

- `MortgageModeBanner.tsx` — макет из §3.4: бейдж, название, остаток/ставка/платёж/`asOf`,
  строка про расхождение расчётного и фактического платежа с `InfoTooltip` (допущения 2 и 3),
  жёлтый вариант при `termFallback`, кнопки «Открыть в трекере» (`/tracker/{id}`) и
  «К моим параметрам» (`exitMortgageMode`).
- `CalculatorPage`: рендер баннера над `ParamsSection`; актуализация из трекера по алгоритму
  §3.3 (`useEffect` на `linkedMortgage?.id`, 404 → `exitMortgageMode()` + notification);
  кнопка «Завести ипотеку из текущего расчёта» скрыта при `linkedMortgage !== null`.
- `MortgagePage`: кнопка «Открыть в калькуляторе» рядом с «Редактировать»;
  задизейблена при `state.currentBalance === 0` с тултипом.
- `MortgageCard`: принимает `events` (список теперь их отдаёт), считает
  `computeMortgageState(mortgage, events, new Date())` — **удалить `[]`-заглушку и её
  комментарий про «состояние по плановому графику»**; добавить кнопку «Открыть в калькуляторе»
  с `e.stopPropagation()`.
- `TrackerListPage`: тип состояния `MortgageDetails[] | null`, рендер
  `<MortgageCard mortgage={d.mortgage} events={d.events} />`.

### B7. Связанные поля (§6, жалоба 3)

- `src/lib/loanLink.ts` — `relinkLoan` по таблице §6, тесты на инвариант
  `principal === propertyPrice − downPayment` для всех трёх полей и на сохранение доли взноса.
- `ParamsSection` — три хендлера заменяются на `relinkLoan` + один `setParams`.
  Поведение не меняется; убедиться, что `maxLoan` (90% цены) и подпись процента взноса живы.
- `MortgageForm` — состояние трёх полей объединяется в один `LoanTriple`,
  каждое поле вызывает `relinkLoan`. Валидация остаётся как страховка.
- `MortgageForm`: дефолт `title` при префилле из калькулятора — `'Моя ипотека'` (G10).

### B8. Мелкие дыры

- `ProtectedRoute`: `<Navigate to="/login" replace state={{ from: location.pathname }} />`.
- `LoginPage`: после входа `navigate(from ?? '/tracker', { replace: true })`; то же в эффекте
  «уже залогинен». Подпись «Войдите, чтобы вести свою ипотеку».
- `ParamsSection`, слайдер «Срок ипотеки»: `inputMin={1}` (G11).

## Критерии готовности B

- [ ] **Жалоба 4:** в любом числовом поле (калькулятор, форма ипотеки, форма корректировки)
      удаление первого символа из `1 000 000` не очищает поле и не прыгает на минимум;
      в поле с `min = 1 000 000` можно набрать `5 000 000` с нуля.
- [ ] **Жалоба 3:** в форме ипотеки изменение цены пересчитывает взнос и кредит;
      изменение кредита пересчитывает взнос; сохранить несогласованную тройку нельзя.
- [ ] **С2:** «Открыть в калькуляторе» со страницы ипотеки и из карточки списка приводит
      на калькулятор с баннером; `результат.loanAmount === round(currentBalance)`;
      ставка и оставшийся срок соответствуют трекеру; графики и вкладки работают.
- [ ] **С2:** «К моим параметрам» возвращает ровно те параметры, что были до входа в режим.
- [ ] **С3:** правка бюджета/зарплаты/горизонта/доходности/ключевой/дисконта у залогиненного
      пережила `localStorage.clear()` + перезагрузку; у гостя — по-прежнему в `localStorage`.
- [ ] **С3:** первый вход нового пользователя засевает настройки из локальных значений
      (ничего не теряется).
- [ ] **С4:** добавил `prepayment` → остаток изменился и на странице ипотеки, и в карточке
      списка, и на калькуляторе после перехода в режим.
- [ ] **G4:** `logout` сбрасывает режим ипотеки; вход под другим аккаунтом не показывает
      чужую ипотеку.
- [ ] **G12:** сборка без `VITE_API_BASE` не делает ни одного запроса к `/api/profile/settings`.
- [ ] Гость, кликнувший «Трекер», после входа попадает на `/tracker`, а не «в никуда».

## Команды проверки B

```bash
npm run typecheck
npm run lint
npm run test -- --run
npm run build
npm run dev        # ручные проверки по критериям выше
```

---

## Общая приёмка (после мержа обоих)

1. Чистая БД → старт API → миграции 001 и 002 применились.
2. Вход через Telegram → `GET /api/profile/settings` вернул `settings: null` → фронт засеял.
3. Правка бюджета → через ~1 с в БД `user_settings.data` обновлён.
4. Заведение ипотеки из калькулятора → карточка в списке с верным остатком.
5. Досрочка на 300 000 ₽ → остаток в списке и на странице уменьшился.
6. «Открыть в калькуляторе» → баннер, `loanAmount` = остаток, вкладки графиков живы.
7. «К моим параметрам» → вернулся исходный сценарий гостя.
