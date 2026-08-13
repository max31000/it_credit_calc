# План: таймлайн идущей ипотеки, стартовые накопления, уже полученные вычеты

Дата: 2026-08-13. Спека: `docs/specs/2026-08-13-mortgage-timeline-design.md`.
**§2 спеки (контракт типов) и §7 (API) — единственный источник правды для A и B.
Расхождение с ними = баг, а не «мелкая свобода реализации».**

## Зоны (не пересекаются ни одним файлом)

| Кто | Владеет | Не трогает |
|-----|---------|-----------|
| **A** | `server/**` + `src/lib/**` (включая `src/lib/__tests__/**`) | `src/api/`, `src/store/`, `src/components/`, `src/pages/`, `docs/`, `.github/`, `deploy/` |
| **B** | `src/api/**`, `src/store/**`, `src/components/**`, `src/pages/**` | `server/`, `src/lib/`, `docs/`, `.github/`, `deploy/` |

Честная оценка объёма: A ≈ 5–6 ч (из них `src/lib` ≈ 3–3,5 ч, сервер ≈ 2 ч),
B ≈ 6–8 ч. Зоны сбалансированы, но **между ними есть типовая зависимость**: B кодирует
против сигнатур из §2 спеки, которых до мержа A физически нет в репозитории.

### Порядок работ (важно)

```
T+0 ──── A: шаги A1–A4 (src/lib: engine, tracker, timeline, mortgageToParams) ────► push
T+0 ──── B: шаги B1–B2 (api/types, MortgageForm) — не зависят от src/lib ──────────►
T+3ч ─── A: шаги A5–A9 (сервер)                        B: шаги B3–B8 (после pull A)
```

`npm run typecheck` у B **не будет зелёным** до мержа ветки A — это ожидаемо и не повод
менять контракт. B пишет код против §2 спеки дословно; первый общий typecheck — после pull.

Общие правила: комментарии и UI-тексты на русском; `docs/` не править (спека написана);
ничего не коммитить без прохождения своих проверок; **ничего не пушить в master**.

---

# Executor A — движок, трекер, таймлайн, сервер

## Файлы

Создать:
```
src/lib/timeline.ts
src/lib/__tests__/timeline.test.ts
server/src/CreditCalc.Api/Data/Migrations/003_mortgage_deductions.sql
```
Изменить:
```
src/lib/engine.ts                 (+3 поля MortgageParams, +4 поля TaxInfo, refundToBase, payoffMonth от 0)
src/lib/tracker.ts                (buildDebtHistory + переписанный computeMortgageState)
src/lib/mortgageToParams.ts       (history в результате, 3 новых поля в маппинге, startingSavings в AccountSettings-хелпере)
src/lib/formatters.ts             (formatMonthsAgo — «5 лет назад», если понадобится тултипу)
src/lib/__tests__/engine.test.ts
src/lib/__tests__/tracker.test.ts        (только дописать новые кейсы; существующие не править — см. A2)
src/lib/__tests__/mortgageToParams.test.ts
server/src/CreditCalc.Api/Contracts/Dtos.cs        (MortgageDto +2, UserSettingsDto +1)
server/src/CreditCalc.Api/Contracts/Requests.cs    (MortgageRequest +2 правила, UserSettingsRequest версия 1|2 + диапазон)
server/src/CreditCalc.Api/Data/MortgageRepository.cs  (INSERT/UPDATE + Mortgage POCO)
server/src/CreditCalc.Api/Data/UserSettingsRepository.cs (нормализация startingSavings при чтении)
server/src/CreditCalc.Api/Endpoints/MortgageEndpoints.cs (ToDto)
server/tests/CreditCalc.Api.Tests/ValidationTests.cs
server/tests/CreditCalc.Api.Tests/UserSettingsValidationTests.cs
server/tests/CreditCalc.Api.Tests/MigrationRunnerTests.cs
```

## Шаги

### A1. Движок: три параметра (§3 спеки)

`MortgageParams` += `startingSavings`, `usedPropertyBase`, `usedInterestBase` (все `number`,
дефолтов в типе нет — их задаёт стор B).

`simulateStrategy`:
* `let savings = params.startingSavings`;
* блок дампа для `prepay` **до** записи `points[0]` — код из §3.1 спеки дословно
  (включая `totalPaid += applied` и `debtFreeMonth = 0` при закрытии);
* стартовые базы вычетов по формулам §3.2;
* `SimResult` += `propertyBaseLeft`, `interestBaseLeft` (значения счётчиков после цикла).

`calculate`:
* `payoffMonth` ищется с `t = 0` (§3.3);
* `TaxInfo` += `propertyBaseStart`, `interestBaseStart`, `propertyBaseLeft`, `interestBaseLeft`
  (значения из `shownSave`, округлённые).

`refundToBase(refund, salary)` — экспортируемая чистая функция по §3.4.

**Не трогать:** `slipAnalysis`, `safetyMonth`, `slip`, `SlipDetails`, форму `series`.

Тесты `engine.test.ts` (дописать):
- дефолтный сценарий с тремя нулями даёт **ровно тот же** результат, что зафиксирован
  существующими тестами (инвариант 1 §9 спеки);
- `series[0].netWorthPrepay === series[0].netWorthSave` при `startingSavings = 1_500_000`;
- `startingSavings > loanAmount` → `summary.prepay.debtFreeMonth === 0`, `payoffMonth === 0`,
  `series[0].debtPrepay === 0`;
- `usedPropertyBase = 2_000_000` → `tax.propertyReturnTotal === 0`, `tax.propertyBaseStart === 0`;
- `usedInterestBase = 3_000_000` → `tax.interestReturnTotal === 0`;
- `usedPropertyBase` частично (700 000) → возврат строго меньше, чем без него, и больше нуля;
- `refundToBase(260_000, null) === 2_000_000`; `refundToBase(x, salary)` с зарплатой
  из верхней ступени шкалы даёт базу меньше, чем при 13%; `refundToBase(0, …) === 0`.

### A2. Трекер: `buildDebtHistory` (§4 спеки)

Реализовать `buildDebtHistory` по алгоритму §4.1 (событие `balance` — снимок, затирает расчёт;
догоняющее применение по `monthKey(e) ≤ start + s`; порядок событий внутри месяца — `(occurredOn, id)`).
Переписать `computeMortgageState` поверх неё (§4.2), **сохранив сигнатуру и `MortgageState` как есть**.

> **Гейт:** существующие кейсы `tracker.test.ts` должны пройти **без единой правки**.
> Если какой-то падает — не «чинить» тест, а остановиться и эскалировать: это значит,
> что семантика реконструкции разошлась с боевой.

Дописать кейсы:
- ипотека без событий: `points.length === elapsed + 1`, долг монотонно убывает,
  `paidInterest > 0`, `interestByYear` суммируется в `paidInterest`;
- `today < startedOn` → одна точка `[principal]`, `elapsedMonths === 0`, `paidInterest === 0`;
- `balance`-событие в середине → точка этого месяца равна сумме события;
- `balance` и `prepayment` в одном месяце: досрочка **после** снимка вычитается, **до** — нет;
- `rate`-событие → `points[k].rate` меняется с нужного месяца, проценты дальше считаются по новой;
- инвариант: `last(points).debt === computeMortgageState(...).currentBalance`.

### A3. `src/lib/timeline.ts` (§2.3, §5.1 спеки)

Чистый модуль без React и без `new Date()`. `buildTimeline` / `toAbsolute` /
`sliceFromToday` / `absoluteMonthLabel` строго по §2.3, правила склейки — оттуда же.

Тесты `timeline.test.ts`:
- `history = null` → `hasHistory === false`, `todayMonth === 0`, длина `points === horizonMonths+1`,
  прогнозные ключи заполнены везде, `debtFact` заполнен только в `month === 0`;
- история длины 61 → `todayMonth === 60`, `points.length === 60 + horizonMonths + 1`;
- в точке `todayMonth` заполнены **все** ключи; в `todayMonth − 1` прогнозные `null`;
  в `todayMonth + 1` фактические `null`;
- `slipPoints[0].month === todayMonth + 1`;
- `toAbsolute(t, 0) === todayMonth`;
- `sliceFromToday(t)[0].month === todayMonth`;
- `absoluteMonthLabel` даёт корректный `YYYY-MM` и `null` без истории.

### A4. `mortgageToParams` (§2.4 спеки)

* возвращает `history: DebtHistory`;
* маппит `usedPropertyBase` / `usedInterestBase` из `MortgageDto`;
* `startingSavings` из `settings`;
* `accountSettingsFromParams` += `startingSavings`.

Тесты: три новых поля доезжают до `params`; `history.points.length − 1 === elapsedMonths`;
`params.apartmentPrice − params.downPayment === round(history.points.at(-1).debt)`.

> **Точка синхронизации.** После A4 — прогон `npm run typecheck && npm run test -- --run`
> (упадут только файлы зоны B, если B уже что-то накоммитил в общую ветку — это ожидаемо)
> и **push**. Дальше A уходит на сервер, B забирает `src/lib`.

### A5. Миграция 003

`Data/Migrations/003_mortgage_deductions.sql` — DDL из §7.2 спеки дословно.
`.csproj` не трогать (`<EmbeddedResource Include="Data\Migrations\*.sql" />` уже есть).

### A6. Контракты сервера

`Dtos.cs`:
* `MortgageDto` += `decimal UsedPropertyBase, decimal UsedInterestBase` **в конец** записи;
* `UserSettingsDto` += `decimal? StartingSavings` **в конец** (nullable — строки, записанные
  версией 1, читаются без ошибок).

`Requests.cs`:
* `MortgageRequest` += те же два поля в конец + три правила валидации из таблицы §7.2;
* `UserSettingsRequest.Validate()`: `Version is not (1 or 2)` → «Неподдерживаемая версия настроек»;
  `StartingSavings is < 0 or > 100_000_000` → «Накопления должны быть от 0 до 100 000 000»
  (`null` — валидно).

### A7. Репозиторий и эндпоинты

* `Mortgage` POCO += два свойства (`SELECT *` + `MatchNamesWithUnderscores` подхватит сам);
* `CreateAsync` / `UpdateAsync` — добавить колонки в INSERT/UPDATE и параметры;
* `MortgageEndpoints.ToDto(Mortgage)` — два новых аргумента;
* `UserSettingsRepository`: при чтении нормализовать `StartingSavings ?? 0` перед отдачей
  (в `ProfileEndpoints` или в репозитории — на усмотрение, но в одном месте и с комментарием);
  `UserSettingsResponse.Version` = версия сохранённой строки, при отсутствии строки — `2`.

### A8. Тесты сервера

`ValidationTests.cs`: валидная тройка вычетов; `UsedPropertyBase = −1`;
`UsedPropertyBase > min(2 млн, цена)` (два кейса: упор в 2 млн и упор в цену при цене 1,5 млн);
`UsedInterestBase = 3_000_001`; `UsedInterestBase = 3_000_000` — валидно.

`UserSettingsValidationTests.cs`: `version = 2` валидна; `version = 1` валидна;
`version = 3` — ошибка; `startingSavings = null` валидно; `−1` и `100_000_001` — ошибки.

`MigrationRunnerTests.cs`: `SplitSqlStatements` на содержимом `003_mortgage_deductions.sql`
возвращает ровно 1 statement.

### A9. Ручная проверка сервера

MySQL в docker: чистая БД → старт → применились 001, 002, 003; существующая БД с данными →
применилась только 003, у старых ипотек колонки `0`; `PUT /api/mortgages/{id}` с новыми полями →
`GET` возвращает их; `PUT /api/profile/settings` с `version: 2` и `startingSavings` → `GET`
возвращает; строка, записанная версией 1, читается и отдаёт `startingSavings: 0`.

## Команды проверки A

```bash
npm run typecheck
npm run test -- --run src/lib
npm run lint

dotnet restore server/CreditCalc.sln
dotnet build   server/CreditCalc.sln -c Release --no-restore
dotnet test    server/CreditCalc.sln -c Release --no-build
```

## Критерии готовности A

- [ ] Все существующие тесты `tracker.test.ts` проходят **без правок**.
- [ ] Инварианты 1–8 из §9 спеки покрыты тестами и зелёные.
- [ ] `computeMortgageState` не изменил ни сигнатуру, ни форму `MortgageState`.
- [ ] `engine.ts` не импортирует ничего из `tracker.ts` / `api/` (проверить руками).
- [ ] `timeline.ts` не импортирует React и не вызывает `new Date()`.
- [ ] Миграция 003 применяется на чистой и на заполненной БД, идемпотентна при рестарте.
- [ ] `PUT /api/mortgages` с `usedPropertyBase` больше лимита → 400 с русским текстом из §7.2.
- [ ] `PUT /api/profile/settings` с `version: 1` (старый клиент) по-прежнему 200.
- [ ] Оба маршрута без `Authorization` → 401 (регрессия не внесена).

---

# Executor B — стор, API-типы, экраны

## Файлы

Изменить:
```
src/api/types.ts                        (MortgageDto/MortgageRequest +2, AccountSettings +1)
src/store/useCalculatorStore.ts         (+3 поля defaultParams, ACCOUNT_SETTING_KEYS +1,
                                         LinkedMortgage +3 поля, linkFromMortgage, persist v4)
src/store/__tests__/useCalculatorStore.test.ts
src/components/sections/ParamsSection.tsx      (накопления + блок вычетов)
src/components/sections/ChartsSection.tsx      (таймлайн, «Сегодня», режим показа)
src/components/sections/SlipSection.tsx        (двухуровневая подпись, алерт про рыночную ставку)
src/components/sections/InsightsSection.tsx    (переформулировки §6 спеки)
src/components/sections/MethodologySection.tsx (новые допущения)
src/components/charts/ChartTooltip.tsx         (todayMonth, startedOn)
src/components/calculator/MortgageModeBanner.tsx (текст допущений)
src/components/tracker/MortgageForm.tsx        (поля вычетов + deductionHelp)
src/components/AccountSettingsSync.tsx         (седьмое поле, version: 2)
src/api/profile.ts                             (version: 2 в PUT)
src/pages/MortgagePage.tsx                     (deductionHelp в форму, linkFromMortgage)
src/pages/CalculatorPage.tsx                   (linkFromMortgage)
src/components/tracker/MortgageCard.tsx        (linkFromMortgage)
```
Создать:
```
src/components/calculator/DeductionsBlock.tsx   (блок «Налоговые вычеты» для ParamsSection)
```

## Шаги

### B1. Типы API (§2.5 спеки) — **не зависит от A**

`MortgageDto` и `MortgageRequest` += `usedPropertyBase: number`, `usedInterestBase: number`.
`AccountSettings` += `startingSavings: number`.
`src/api/profile.ts`: `putSettings` шлёт `version: 2`.

### B2. `MortgageForm`: поля вычетов — **не зависит от A**

Два `NumericInput` в новой секции формы «Налоговые вычеты (уже полученные)»:
* «Имущественный вычет: израсходовано базы, ₽» — `min 0`, `max = min(2_000_000, propertyPrice)`;
* «Вычет по процентам: израсходовано базы, ₽» — `min 0`, `max 3_000_000`.

Дефолты при создании: `0` (не `null` — сервер требует число).
Клиентская валидация зеркалит §7.2 спеки.

Новый опциональный проп:
```ts
deductionHelp?: { interestByYear: Record<number, number>; paidInterest: number }
```
При его наличии под полем процентов рендерится помощник (§1.5 спеки):
`Select` «Вычет получен по … год включительно» → записывает
`min(3_000_000, Σ interestByYear[y] для y ≤ выбранного)`, плюс кнопка «за всё время»
→ `min(3_000_000, paidInterest)`. Помощник только **пишет число** в поле; никакого
собственного состояния, которое надо было бы хранить.

> Помощник — **последний по приоритету** пункт всего плана. Если время поджимает,
> его можно выкатить отдельно: поля вычетов работоспособны и без него.

### B3. Стор (§2.6 спеки) — после pull ветки A

* `defaultParams` += `startingSavings: 0`, `usedPropertyBase: 0`, `usedInterestBase: 0`;
* `ACCOUNT_SETTING_KEYS` += `'startingSavings'` (→ автоматически синхронизируется на сервер
  и пишется в оба набора параметров существующим правилом `setParam`);
* `LinkedMortgage` += `startedOn?`, `history?: number[]`, `paidInterest?` (все опциональные);
* экспортировать `linkFromMortgage(mortgage, mapped)` — собирает `LinkedMortgage`
  (`history` = `mapped.history.points.map(p => p.debt)`, `paidInterest` = `mapped.history.paidInterest`);
* `persist`: `version: 4`, `migrate` при `v < 4` дозаливает три новых поля нулями
  в `params` и `ownParams` и **сбрасывает `linkedMortgage.history` в `undefined`**
  (старый персист их не содержит — пусть перезапросится);
* `applyAccountSettings` += `startingSavings`.

Тесты стора (дописать):
- миграция persist v3 → v4 даёт три новых поля с нулями;
- правка `startingSavings` в режиме ипотеки уходит и в `ownParams` (ключ аккаунта);
- правка `usedInterestBase` в режиме ипотеки **не** уходит в `ownParams` (сценарный ключ);
- `linkFromMortgage` кладёт `history.at(-1) === round(state.currentBalance)`.

### B4. Три точки входа в режим ипотеки

`MortgagePage`, `MortgageCard`, `CalculatorPage` — заменить три копии литерала `LinkedMortgage`
на `linkFromMortgage(mortgage, mapped)`. Поведение то же, копипаста исчезает,
новые поля не забываются ни в одной точке.

### B5. `AccountSettingsSync`

Седьмое поле подхватывается автоматически (сравнение идёт по `ACCOUNT_SETTING_KEYS`).
Проверить: сеяние при `settings === null` берёт `startingSavings` из `ownParams`;
приход с сервера значения `undefined` (старая строка) → трактуется как `0`, а не как `NaN`.

### B6. `ParamsSection`: накопления и вычеты

* `SliderInput` **«Текущие накопления»** в правой колонке над «Бюджет на ипотеку в месяц»:
  `min 0`, `max 5_000_000`, `step 50_000`, `inputMax 100_000_000`, формат `formatRub`,
  тултип: «Деньги, которые у вас уже есть сверх кредита. Подход „копить“ оставит их
  на вкладе, подход „гасить досрочно“ внесёт в долг сразу — стартовый капитал
  у обоих подходов одинаков, сравнение честное.»
  Алерт при `startingSavings >= result.loanAmount`: «Накоплений уже хватает, чтобы закрыть
  остаток долга целиком».
* Новый `DeductionsBlock.tsx` под полем зарплаты (§1.5, §8 спеки):
  `SegmentedControl` имущественного вычета (Не получал / Частично / Полностью),
  условное поле «Уже вернули, ₽» → `setParam('usedPropertyBase', refundToBase(v, salary))`,
  поле «Уже вернули по процентам, ₽» → `usedInterestBase`, производные строки
  «израсходовано базы ≈ X ₽ из Y ₽» и «доступно к возврату ещё ≈ Z ₽»
  (из `result.tax.propertyBaseStart` / `interestBaseStart`).
  Состояние `SegmentedControl` выводится из `usedPropertyBase` (0 → «Не получал»,
  ≥ лимита → «Полностью», иначе «Частично») — отдельного персиста не заводить.
  При `salary === null` — блок свёрнут со строкой «Укажите зарплату, чтобы учитывать вычеты».

### B7. Графики (§5 спеки) — ядро задачи

* один `useMemo` с `buildTimeline(result, link?.history ?? null, link?.startedOn ?? null)`
  в `ChartsSection`, результат раздаётся во вкладки пропсами (три локальных `useMemo`
  во вкладках убрать);
* `ChartFrame`: тип данных `Array<Record<string, number | null>>`;
* `SegmentedControl` «Весь срок» / «От сегодня» (`useState`, дефолт `full`), только при `hasHistory`;
* `ReferenceLine x={timeline.todayMonth}` «Сегодня» на всех трёх вкладках при `hasHistory`;
* линия `debtFact` на «Долг и накопления», линия `netWorthFact` на «Капитал» —
  цвета/стили из §5.3 спеки, тексты подписей — оттуда же дословно;
* **все** `ReferenceLine` по X переводятся через `toAbsolute`: слёт, `safetyMonth`, `payoffMonth`;
  линия `payoffMonth` скрывается при `payoffMonth === 0`;
* `ChartTooltip` получает `todayMonth` и `startedOn`, формат заголовка — §5.4 спеки.

Ручная проверка: гостевой сценарий — графики визуально идентичны текущим (открыть до и после).

### B8. Слёт, выводы, методология, баннер

* `SlipSection`: `secondaryLabel` двухуровневый (§1.4 спеки) — считает абсолютный месяц как
  `linkedMortgage.history.length − 1 + slipMonth` и календарную дату из `startedOn`;
  алерт при `params.itRate >= result.marketRateAtSlip` (§1.7).
* `InsightsSection`: переформулировки по таблице §6 + новая карточка «Сколько уже пройдено»
  при наличии `history`. Проверить, что **без** режима ипотеки тексты не изменились.
* `MethodologySection`: абзацы по §8 спеки.
* `MortgageModeBanner`: из `ASSUMPTIONS_TEXT` убрать пункт про завышение вычета по процентам,
  добавить «прошлое до «сегодня» восстановлено по корректировкам трекера».

## Команды проверки B

```bash
npm run typecheck        # зелёный только после pull ветки A
npm run lint
npm run test -- --run
npm run build
npm run dev              # ручные проверки по критериям ниже
```

## Критерии готовности B

- [ ] **Гость (регрессия):** без входа в режим ипотеки все три вкладки графиков выглядят
      и ведут себя как до задачи; тексты выводов не изменились.
- [ ] **A:** «Открыть в калькуляторе» → на «Долг и накопления» видна фактическая линия долга
      от месяца 0, вертикаль «Сегодня» стоит там, где заканчивается факт и начинается прогноз,
      значение факта в точке стыка совпадает с остатком в баннере.
- [ ] **A:** переключатель «Весь срок / От сегодня» меняет диапазон и не ломает вертикали.
- [ ] **A:** тултип в прошлом показывает месяц ипотеки и календарный месяц.
- [ ] **B:** ввод накоплений 1 000 000 → на вкладке «Капитал» обе прогнозные линии стартуют
      на 1 000 000 выше серой фактической, и стартовый капитал у обоих подходов одинаков.
- [ ] **B:** накопления ≥ остатка → алерт в параметрах, `payoffMonth = 0`,
      карточка выводов говорит «уже сейчас хватает», линия «Хватает на закрытие» не рисуется.
- [ ] **B:** значение накоплений пережило `localStorage.clear()` + перезагрузку у залогиненного.
- [ ] **C:** «имущественный получен полностью» → сумма вычетов за горизонт падает ровно
      на имущественную часть; повторного начисления нет.
- [ ] **C:** ввод суммы возврата по процентам уменьшает прогноз вычета и показывает
      корректный остаток базы.
- [ ] **C:** поля вычетов, сохранённые в форме ипотеки, доезжают до калькулятора после
      «Открыть в калькуляторе» и переживают перезаход на страницу.
- [ ] **Edge:** ипотека с `termFallback` (платёж не покрывает проценты) — история рисуется
      растущим долгом, страница не падает.
- [ ] **Edge:** ставка в трекере уже рыночная → в блоке слёта появился алерт.
- [ ] Подпись месяца слёта в режиме ипотеки показывает и «от сегодня», и «месяц ипотеки».

---

## Общая приёмка (после мержа обоих)

1. Чистая БД → старт API → применились 001, 002, 003.
2. Заведена ипотека с датой выдачи 3 года назад, добавлены `prepayment` и `rate`-корректировки.
3. «Открыть в калькуляторе» → на графике видны 36 месяцев факта, вертикаль «Сегодня»,
   дальше прогноз; остаток в точке стыка = остаток в баннере = остаток на странице ипотеки.
4. Введены накопления 1,5 млн → обе стратегии стартуют с одинакового капитала;
   точка «хватает на закрытие» сдвинулась влево.
5. В форме ипотеки отмечено «имущественный получен полностью» и «вычет по процентам получен
   по 2025 год» → сумма вычетов за горизонт уменьшилась, в карточке видно остаток базы.
6. Перезаход на калькулятор → все три новых значения на месте (накопления — из настроек
   аккаунта, вычеты — из ипотеки).
7. «К моим параметрам» → гостевой сценарий вернулся целиком, история и вертикаль «Сегодня»
   исчезли, графики как до задачи.
8. Сборка GitHub Pages (`TRACKER_ENABLED === false`) → калькулятор работает, ни одного
   сетевого запроса, поля накоплений и вычетов доступны и считаются.
