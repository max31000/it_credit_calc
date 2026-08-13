# План: непрерывная симуляция ипотеки от даты выдачи

Дата: 2026-08-14. Спека: `docs/specs/2026-08-14-continuous-simulation-design.md`.
**§2 спеки (контракт типов) — заморожен и является единственным источником правды
для A, B и C. Расхождение с ним = баг, а не свобода реализации.**

Мандат владельца: **правильно, а не быстро.** Глубокая переработка допустима;
обратная совместимость гостевого результата обязательна и проверяется машинно.

---

## Зоны

| Кто | Владеет (единолично) | Не трогает |
|-----|----------------------|-----------|
| **A** — библиотека | `src/lib/**` (включая `src/lib/__tests__/**`) | `src/api/`, `src/store/`, `src/components/`, `src/pages/`, `docs/`, `server/`, `.github/`, `deploy/` |
| **B** — стор, параметры, точки входа | `src/store/**`, `src/pages/**`, `src/components/calculator/**`, `src/components/tracker/**`, `src/components/sections/ParamsSection.tsx`, `src/components/sections/SlipSection.tsx`, `src/components/AccountSettingsSync.tsx` | `src/lib/`, `src/api/`, `src/components/sections/{Charts,Insights,Methodology}Section.tsx`, `src/components/charts/`, `docs/`, `server/` |
| **C** — графики, выводы, отчётность в UI | `src/components/sections/ChartsSection.tsx`, `src/components/sections/InsightsSection.tsx`, `src/components/sections/MethodologySection.tsx`, `src/components/charts/**` | всё остальное |

**Сервер не участвует** — обоснование в §13 спеки: ни одного нового поля, ни одной миграции,
`server/**` не открывается вообще. Это же снимает необходимость в четвёртом исполнителе
и в ожидании деплоя API.

Пересечений файлов между зонами нет. `src/api/**` в этой фазе не меняется никем.

### Порядок работ

```
T+0    A0  ── golden-фикстура гостя (ДО любых правок кода) ──► push, обязателен всем
T+0    A1…A6  ── src/lib целиком ─────────────────────────────► push
T+A    B1…B7  ──┬── после pull ветки A
                └── C1…C5  ── параллельно B, файлы не пересекаются
T+BC   общая приёмка
```

`npm run typecheck` у B и C **не будет зелёным** до мержа ветки A — это ожидаемо
(тот же режим, что в фазе 5). B и C пишут код против §2 спеки дословно.
C дополнительно зависит от полей стора, которые добавляет B (`mortgageFact`, `factError`) —
контракт зафиксирован в §2.6 спеки, первый общий typecheck после мержа обоих.

Общие правила: комментарии и UI-тексты на русском; `docs/` никто не правит (спека написана);
**ничего не коммитить и не пушить в master**; каждый исполнитель гоняет свои проверки
до передачи работы.

---

# Executor A — движок, трекер, таймлайн, отчётность

Оценка: 10–13 ч. Это ядро задачи, торопиться здесь запрещено.

## Файлы

Создать:
```
src/lib/reporting.ts
src/lib/__tests__/reporting.test.ts
src/lib/__tests__/guestGolden.test.ts
src/lib/__tests__/fixtures/guest-golden.json     (генерируется шагом A0)
```
Изменить:
```
src/lib/engine.ts
src/lib/tracker.ts
src/lib/timeline.ts
src/lib/mortgageToParams.ts
src/lib/__tests__/engine.test.ts          (только дописывание; разделы 1–7, 10 не трогать)
src/lib/__tests__/tracker.test.ts         (только дописывание; существующие кейсы не трогать)
src/lib/__tests__/timeline.test.ts        (правятся только вызовы под новую сигнатуру)
src/lib/__tests__/mortgageToParams.test.ts (переписывается целиком — §12.3 спеки)
```

## Шаги

### A0. Golden-фикстура гостя — ПЕРВЫЙ КОММИТ, до правок кода

Создать `src/lib/__tests__/guestGolden.test.ts` с:

* функцией-проекцией `projectGuest(result)`, перечисляющей **явным списком** только поля,
  существующие до фазы 6 (полный список — §12.1 спеки). Никаких `Object.keys` и spread:
  новые поля движка тест видеть не должен;
* пятью наборами параметров (§12.1 спеки);
* режимом записи: если `process.env.UPDATE_GUEST_GOLDEN === '1'` — тест пишет
  `fixtures/guest-golden.json` и помечается `it.skip`-эквивалентом; иначе — сравнивает
  `toEqual` с содержимым файла.

Сгенерировать фикстуру на **текущем** (ещё не изменённом) коде:

```bash
UPDATE_GUEST_GOLDEN=1 npx vitest run src/lib/__tests__/guestGolden.test.ts
npx vitest run src/lib/__tests__/guestGolden.test.ts     # должен быть зелёным без переменной
git add src/lib/__tests__/fixtures/guest-golden.json src/lib/__tests__/guestGolden.test.ts
```

> **Запрет на всю фазу 6:** `UPDATE_GUEST_GOLDEN=1` больше не запускается никем.
> Красный `guestGolden` — блокер, а не повод перегенерировать файл.

### A1. `tracker.ts`: разложение движения денег (§2.2, §4 спеки)

1. `DebtHistoryPoint` += `scheduledPaid`, `principalPaid`, `prepayment`, `snapshotAdjustment`.
2. Тело цикла — по §4.1 спеки: `scheduledPaid = min(payment, balance + interest)`,
   `balance = balance + interest − scheduledPaid` (без `Math.max(0, …)` — усечение уже сделано
   `min`), досрочка `applied = min(e.amount, balance)`, снимок
   `snapshotAdjustment += e.amount − balance` перед присвоением.
3. `DebtHistory` += `paidScheduled`, `paidPrepayments`, `paidTotal`, `principalRepaid`,
   `snapshotDrift`, `hasSnapshots`.
4. `paidInterest` и `interestByYear` накапливать **в неокруглённых величинах**,
   `round2` — один раз в конце (§4.3 спеки).
5. `FactEvent`, `MortgageFact`, `buildMortgageFact(m, events, today)` — по §2.2 спеки.
   `remainingMonths` — по формуле оттуда же (**срок по договору**, проекция `monthsToPayoff`
   только когда срок истёк). `taxSettleOffset = (12 − monthNumber(today)) % 12`.
6. `computeMortgageState` — сигнатура и `MortgageState` **не трогать**.
7. `monthsToPayoff` понадобится `buildMortgageFact` — оставить приватной в модуле, не экспортировать.

Тесты (дописать в `tracker.test.ts`, существующие не трогать):
* **И1** закон сохранения: набор из снимка + двух досрочек + смены ставки — равенство
  `paidScheduled + paidPrepayments === paidInterest + (principal − debtLast) + snapshotDrift`
  с точностью 0,01; отдельный кейс без снимков → `snapshotDrift === 0`, `hasSnapshots === false`;
* `scheduledPaid` в месяце закрытия долга равен `debt + interest`, не полному платежу;
* при платеже меньше процентов `principalPaid < 0`, долг растёт, закон сохранения держится;
* `buildMortgageFact`: `engine.debt === computeMortgageState(...).currentBalance`,
  `engine.remainingMonths === termMonths − elapsedMonths` для незакрытой ипотеки в срок;
* `taxSettleOffset`: `today = 2026-08-13 → 4`, `2026-12-31 → 0`, `2026-01-05 → 11`;
* `events` содержит только события с `occurredOn <= today`, в порядке `(occurredOn, id)`.

### A2. `engine.ts`: стартовое состояние (§2.1, §3.1 спеки)

1. Экспортировать `FactPhase`.
2. `resolveStart(params, fact)` — код из §3.1 спеки дословно; **единственное** место,
   где берётся сумма кредита, ставка, срок и стартовый платёж.
3. `simulateStrategy(params, opts, fact)` использует `start`; тело цикла не меняется.
4. `calculate(params, fact?)`:
   * `loanAmount = start.debt`;
   * `minPayment = round(start.payment)`;
   * `totalInterest = round(factInterest + max(0, start.payment × start.months − start.debt))`
     — **одно выражение на оба режима**;
   * `n = start.months` везде, где раньше был `termYears × 12` (`effectiveSlip`, `slipAnalysis`,
     `slip.remainingMonths`).
5. `SimPoint` += `interest`; `MonthlyPoint` += `interestPrepay`, `interestSave`.
6. `StrategyResult` += `totalPaidWithFact`, `totalInterestWithFact` (§3.4 спеки).

**Не трогать:** `slipAnalysis`, `safetyMonth`, `payoffMonth`, `slip`, `SlipDetails`, `SimOptions`,
порядок симуляций, дамп `startingSavings`, `refundToBase`, `calcActualNDFL`, `calcNDFLRate`,
единицы `slipMonth`.

> **Гейт после A2:** `guestGolden` зелёный. Если красный — остановиться и разобраться,
> а не подгонять фикстуру.

### A3. `engine.ts`: календарные налоговые годы (§3.3 спеки)

1. `offset = fact ? fact.taxSettleOffset : 12`; `isYearEnd(t)`, `k(t)`, `year`, `calendarYear`
   по формулам §3.3.
2. Начисление вынести в замыкание `settleTaxYear(t)`; вызывать внутри цикла и **однократно
   до записи `points[0]`, если `offset === 0`**.
3. `interestDeductiblePool` инициализируется `fact ? max(0, fact.paidInterest − usedInterestBase) : 0`.
4. `TaxInfo.byYear[i]` += `calendarYear: number | null`.

Тесты (`engine.test.ts`, новый раздел):
* **И5** равенство стартового капитала при `offset = 0` и `startingSavings > 0`;
* **И7** результат не зависит от `downPayment` / `termYears` / `itRate` при переданном факте;
* **И6** эквивалентность гостю при `elapsed = 0` (сравнение через ту же `projectGuest`);
* **И9**, **И10**, **И11**, **И12** дословно по §11 спеки;
* **И2** тождество `interest + Δdebt` для обеих стратегий.

### A4. `timeline.ts` (§2.3 спеки)

Новая сигнатура `buildTimeline(result, fact)`, `Timeline` += `hasFact` (вместо `hasHistory`),
`markers`. Правила склейки не менять. `toAbsolute` / `sliceFromToday` / `absoluteMonthLabel` —
без изменений.

Тесты: правятся **только вызовы**; утверждения о гостевом поведении переносятся дословно.
Дописать: **И3**, **И4**, **И15**, маркеры содержат только `prepayment` и `rate`.

### A5. `reporting.ts` (§2.4, §6.2, §7.3 спеки)

Чистый модуль, без React, без `new Date()`.

* `buildCashFlow(result, fact, strategy)` — годовые бакеты; месячный платёж прогноза
  восстанавливается как `interest + (debt[t−1] − debt[t])`; тело = `paid − interest − prepayment`,
  где для `save` `prepayment = 0` кроме месяца слёта, а для `prepay` — всё сверх обязательного
  платежа (`series[t].paymentPrepay`). Годы: календарные при `fact !== null`, порядковые 1…N иначе.
* `buildDeductionReport(result, fact, params)` — строки прошлого из `fact.history.interestByYear`
  со статусом по нарастающему итогу (§6.2), строки будущего из `result.tax.byYear`,
  год стыка `kind: 'mixed'`; `claimedThroughYear` выводится, не хранится.
  `null` при `params.salary === null`.

Тесты `reporting.test.ts`: **И13**, **И14**; гость (`fact = null`) даёт только прогнозные строки
с порядковыми годами; год стыка помечен `mixed` и содержит и факт, и прогноз;
`usedInterestBase > paidInterest` → все прошлые годы `claimed`.

### A6. `mortgageToParams.ts` (§2.5 спеки)

* `downPayment = mortgage.downPayment` (реальный);
* `termYears = clamp(ceil(fact.engine.remainingMonths / 12), 1, 30)` — **только** для границы
  слайдера слёта, с комментарием об этом;
* `horizonYears = settings.horizonYears` — кламп сроком убрать;
* возвращает `fact: MortgageFact`;
* `termFallback = !fact.paymentCoversInterest`;
* `accountSettingsFromParams` — без изменений.

`mortgageToParams.test.ts` **переписывается целиком** (§12.3 спеки): старые кейсы фиксируют
отвергнутую модель. Новые — **И8**, плюс: горизонт не ужимается сроком; `termYears` покрывает
остаток срока; `fact.engine.debt === state.currentBalance`.

## Команды проверки A

```bash
npx vitest run src/lib/__tests__/guestGolden.test.ts   # обязателен после каждого шага A2…A6
npm run typecheck
npm run test -- --run src/lib
npm run lint
```

## Критерии готовности A

- [ ] `guestGolden` зелёный, `fixtures/guest-golden.json` **не изменён** ни одним коммитом после A0.
- [ ] `src/lib/__tests__/tracker.test.ts`: существующие кейсы прошли **без единой правки**.
- [ ] `src/lib/__tests__/engine.test.ts`: разделы 1–7 и 10 не изменены (проверить `git diff`).
- [ ] Инварианты И1–И15 покрыты тестами и зелёные.
- [ ] `engine.ts` не импортирует ничего из `tracker.ts` и `api/`; не содержит `new Date`.
- [ ] `timeline.ts` и `reporting.ts` не импортируют React и не содержат `new Date`.
- [ ] `computeMortgageState` — та же сигнатура и та же форма `MortgageState`.
- [ ] `grep -n "downPayment" src/lib/engine.ts` показывает единственное вхождение — внутри
      `resolveStart` в гостевой ветке.
- [ ] `server/**` не открывался.

---

# Executor B — стор, параметры, точки входа

Оценка: 6–8 ч. Начинать после pull ветки A.

## Файлы

Создать:
```
src/components/calculator/MortgageFactsCard.tsx
```
Изменить:
```
src/store/useCalculatorStore.ts
src/store/__tests__/useCalculatorStore.test.ts
src/components/sections/ParamsSection.tsx
src/components/sections/SlipSection.tsx
src/components/calculator/MortgageModeBanner.tsx
src/components/calculator/DeductionsBlock.tsx
src/components/tracker/MortgageCard.tsx
src/components/tracker/MortgageForm.tsx
src/pages/CalculatorPage.tsx
src/pages/MortgagePage.tsx
src/components/AccountSettingsSync.tsx      (проверить, правок может не понадобиться)
```

## Шаги

### B1. Стор (§2.6 спеки)

* `LinkedMortgage`: убрать `history`, добавить `principal?`, `paidInterest?`, `elapsedMonths?`.
* Состояние += `mortgageFact: MortgageFact | null`, `factError: string | null`,
  экшен `setFactError`.
* `recalc(params, slipEnabled, fact)` → `calculate({...params, slipMonth}, fact?.engine ?? null)`.
  **Все** места пересчёта (`setParam`, `setParams`, `setSlipEnabled`, `applyAccountSettings`,
  `enterMortgageMode`, `exitMortgageMode`, `onRehydrateStorage`) передают текущий `mortgageFact`.
* `enterMortgageMode(link, params, fact)` — третий аргумент обязателен; ставит
  `mortgageFact: fact`, `factError: null`.
* `exitMortgageMode` — сбрасывает `mortgageFact` и `factError` в `null`.
* `persist`: `version: 5`, `partialize` **без** `mortgageFact`/`factError`;
  `migrate` при `v < 5` дозаливает поля `MortgageParams` дефолтами и вычищает
  `linkedMortgage.history`/`paidInterest` (страница перезапросит).
* `onRehydrateStorage`: `mortgageFact = null`, `factError = null`.

Тесты стора (дописать; существующие кейсы тумблера и правил записи в `ownParams` не трогать):
* `enterMortgageMode` кладёт факт, и `result.loanAmount === round(fact.engine.debt)`;
* `exitMortgageMode` обнуляет факт, и результат совпадает с гостевым для `ownParams`;
* правка `freeMonthly` в режиме ипотеки пересчитывает результат **с фактом** (не теряет его);
* миграция v4 → v5 вычищает `history` и не роняет стор;
* после `onRehydrateStorage` в режиме ипотеки `mortgageFact === null`.

### B2. Три точки входа

`MortgagePage`, `MortgageCard`, `CalculatorPage` — вместо `mortgageToParams(...).history`
передают `mapped.fact` третьим аргументом `enterMortgageMode`.

`CalculatorPage.useEffect`: при ошибке сети — `setFactError(текст)`; при 404 — как сейчас,
`exitMortgageMode` + нотификация. При успехе — `setFactError(null)` и `enterMortgageMode`.

`MortgagePage` продолжает передавать `deductionHelp={{ interestByYear, paidInterest }}`,
но берёт их из `mapped.fact.history` вместо отдельного вызова `buildDebtHistory`
(один вызов вместо двух).

`handleCreateFromCalculator` в `CalculatorPage` не меняется (гостевой путь).

### B3. Гейт загрузки факта (§8.4 спеки)

В `CalculatorPage`:
```
const pending = linkedMortgage !== null && mortgageFact === null && factError === null
const failed  = linkedMortgage !== null && factError !== null
```
* `pending` → вместо `ParamsSection`/`SlipSection`/`InsightsSection`/`ChartsSection`
  рендерится `<Skeleton height={…} />` ×3; баннер остаётся с бейджем «обновляем…»;
* `failed` → `Alert` «Не удалось загрузить данные ипотеки — расчёт не показан»
  с кнопками «Повторить» (перезапуск эффекта) и «К моим параметрам» (`exitMortgageMode`);
  разделы расчёта не рендерятся.

Гость (`linkedMortgage === null`) — путь не задействован вообще.

### B4. `MortgageFactsCard` (§8.2 спеки)

Новый компонент: read-only таблица из восьми строк по §8.2 спеки, кнопки
«Изменить в трекере» (`/tracker/{id}`) и «К моим параметрам». Алерты:
`termExpired` → «срок по договору истёк, а долг остался»;
`!paymentCoversInterest` → «текущий платёж не покрывает проценты — долг растёт».
Никаких слайдеров и никаких `setParam`.

### B5. `ParamsSection`

```
const fact = useCalculatorStore((s) => s.mortgageFact)
…
{fact ? <MortgageFactsCard fact={fact} /> : <ЛеваяКолонкаСлайдеров/>}
```
Правая колонка (накопления, бюджет, доходность, горизонт, зарплата, `DeductionsBlock`)
рендерится в обоих режимах без изменений.

Кламп горизонта сроком (`Math.min(v, params.termYears)` в `onChange`) оставить **только**
для гостя (`fact === null`); в режиме ипотеки горизонт свободен (§7.4 спеки),
подпись «Ограничено сроком ипотеки» показывать только у гостя.

> **Регрессия:** гостевой вид `ParamsSection` должен остаться пиксель-в-пиксель прежним.
> Проверяется сравнением скриншотов до/после.

### B6. `SlipSection`, баннер, `DeductionsBlock`

* `SlipSection`: `todayMonth` берётся из `mortgageFact.elapsedMonths`,
  `startedOn` — из `mortgageFact.startedOn` (вместо `linkedMortgage.history.length − 1`).
  Логика и тексты не меняются.
* `MortgageModeBanner`: из `ASSUMPTIONS_TEXT` **убрать** пункт про округление срока и
  расхождение платежа — его больше нет. Строку «Расчётный платёж калькулятора … — срок округлён
  до лет» удалить целиком. Новый текст допущений: «Прошлое до сегодня восстановлено по
  корректировкам трекера; снимки остатка из банка считаются авторитетнее расчёта.
  Прогноз продолжает эту же ипотеку с сегодняшнего остатка, ставки и платежа.»
  Бейдж «обновляем…» при `pending`.
* `DeductionsBlock`: без функциональных изменений; в тултипе вычета по процентам уточнить,
  что прошлые годы видны в таблице вычетов.

### B7. `MortgageForm`

Хелпер «получено по год N» уже есть — источник данных меняется на `mapped.fact.history`
(шаг B2). Дополнительно: под полем показывать выведенный `claimedThroughYear`, если он не null
(строка «введённой базы хватает на проценты по N год включительно»).
Значение берётся из `reporting.buildDeductionReport` — вызывать нельзя (это зона C по UI),
поэтому здесь **достаточно** оставить как есть; строку добавляет C в таблице вычетов.
Фактически шаг B7 сводится к проверке, что форма продолжает работать после B2.

## Команды проверки B

```bash
npm run typecheck
npm run lint
npm run test -- --run src/store
npm run build
npm run dev
```

## Критерии готовности B

- [ ] Гость: `ParamsSection` визуально не изменился; все слайдеры работают как раньше.
- [ ] Режим ипотеки: слайдеров цены/взноса/суммы/ставки/срока **нет**, вместо них карточка фактов.
- [ ] В карточке фактов первоначальный взнос равен тому, что введено в трекере
      (а не «цена − остаток»).
- [ ] Обязательный платёж в выводах равен фактическому платежу из трекера **точно**,
      строки про округление срока в баннере нет.
- [ ] Горизонт в режиме ипотеки не ужимается остатком срока.
- [ ] Холодная перезагрузка страницы в режиме ипотеки: сначала скелетоны, затем расчёт;
      неверные числа не мелькают.
- [ ] Отключённая сеть в режиме ипотеки: алерт вместо расчёта, кнопка «Повторить» работает.
- [ ] «К моим параметрам» возвращает гостевой сценарий целиком.
- [ ] `localStorage` после работы в режиме ипотеки не содержит ключа `history`.

---

# Executor C — графики, выводы, методология

Оценка: 6–8 ч. Начинать после pull ветки A, параллельно B.

## Файлы

Изменить:
```
src/components/sections/ChartsSection.tsx
src/components/sections/InsightsSection.tsx
src/components/sections/MethodologySection.tsx
src/components/charts/ChartTooltip.tsx
src/components/charts/chartUtils.ts
```

## Шаги

### C1. `ChartsSection`: источник данных

```ts
const fact = useCalculatorStore((s) => s.mortgageFact)
const timeline = useMemo(() => buildTimeline(result, fact), [result, fact])
```
`linkedMortgage.history` больше не читается нигде. `timeline.hasHistory` → `timeline.hasFact`.
Остальная механика вкладок «Капитал», «Долг и накопления», «Риск слёта» (вертикаль «Сегодня»,
`SegmentedControl` «Весь срок / От сегодня», `toAbsolute` для всех `ReferenceLine`) —
без изменений.

### C2. Видимые частичные закрытия (§7.2 спеки)

На вкладке «Долг и накопления»:
* `ReferenceDot` для каждого `marker.kind === 'prepayment'` в точке
  `(marker.month, points[marker.month].debtFact)`, `r=5`, `fill=CHART_COLORS.payoff`;
* `ReferenceLine` с `strokeDasharray` для `marker.kind === 'rate'`, подпись «ставка N%»;
* в легенде — пояснение «точки на линии факта — досрочные погашения».

Тултип точки: сумма досрочки и месяц (`ChartTooltip` уже умеет календарную подпись).

### C3. Новая вкладка «Движение денег» (§7.3 спеки)

`BarChart` из recharts, данные — `reporting.buildCashFlow(result, fact, strategy)`:
три `Bar` со `stackId` — «Проценты» (`CHART_COLORS.danger`), «Тело» (`CHART_COLORS.save`),
«Досрочки» (`CHART_COLORS.payoff`). Прогнозные годы — `fillOpacity 0.45`
(через `<Cell>` по `kind`). `SegmentedControl` выбора стратегии над графиком.
Подпись: «Слева от «Сегодня» — фактически внесённые деньги по данным трекера,
справа — прогноз выбранного подхода. Год стыка содержит и то, и другое.»

Если `horizonMonths > remainingMonths` — дополнительная подпись «срок ипотеки заканчивается
на N-м месяце — дальше сравниваются только накопления» (§7.4 спеки).

### C4. `InsightsSection` (§5 спеки)

* Метрика «Обязательный платёж» — без изменений (теперь она честная сама по себе).
* Метрика «Переплата по графику» → «Переплата по графику за весь срок», описание
  «уже уплачено X · впереди Y» при наличии факта; при `!paymentCoversInterest` —
  показывать только факт и алерт (§5.1 спеки).
* Новые метрики/строки: «Уплачено банку с начала ипотеки» = `summary.save.totalPaidWithFact`,
  «из них процентов» = `summary.save.totalInterestWithFact` (при `fact === null` карточка
  подписывается «за горизонт», как сейчас, и значения совпадают с прежними).
* Карточка **«Что уже произошло»** (только при `fact !== null`) — формулировка из §5 спеки
  дословно, включая число досрочек и их сумму; строка про `snapshotDrift` при `|drift| > 1000`.
* Таблица вычетов по годам (`reporting.buildDeductionReport`) — `<Table>` внутри
  `<Accordion>` под метрикой налоговых вычетов; колонки: год, проценты за год, что с вычетом,
  возврат. Строки `kind: 'fact'` — приглушённые, `'mixed'` — с пометкой «частично факт».
  При `fact === null` таблица показывает только прогнозные годы с порядковой нумерацией
  (для гостя это новая, но безобидная информация — существующие тексты не меняются).
* Точка безопасности, точка погашения, карточки слёта — формулировки **не менять**.

### C5. `MethodologySection`, `ChartTooltip`, `chartUtils`

* `MethodologySection`: новый абзац «Как считается идущая ипотека» — факт-фаза по событиям
  трекера, снимок банка авторитетнее расчёта, прогноз стартует с фактического остатка/ставки/
  платежа, остаток срока берётся из договора (а не из проекции), налоговые годы календарные,
  переплата по графику = факт + остаток по текущему графику. Убрать абзац про округление срока.
* `ChartTooltip`: переименовать проп `todayMonth` семантику не меняя; добавить необязательный
  `valueFormatter` для вкладки движения денег (там значения — суммы за год, не остатки).
* `chartUtils`: `xTickFormatter` не менять; добавить `yearTickFormatter` для новой вкладки.

## Команды проверки C

```bash
npm run typecheck
npm run lint
npm run test -- --run
npm run build
npm run dev
```

## Критерии готовности C

- [ ] Гость: все существующие вкладки выглядят и ведут себя как до задачи; тексты выводов
      (кроме подписи метрики переплаты) не изменились.
- [ ] Режим ипотеки: на «Долг и накопления» видна линия факта от месяца 0, на ней —
      точки досрочек; значение в точке стыка равно остатку в карточке фактов.
- [ ] Вкладка «Движение денег»: сумма фактических лет сходится с «внесено банку»
      из карточки «Что уже произошло».
- [ ] Карточка «Что уже произошло» называет число досрочек и их сумму.
- [ ] Таблица вычетов показывает прошлые годы с фактическими процентами и статусом,
      текущий год помечен «частично факт», будущие — прогнозом.
- [ ] Переключатель «Весь срок / От сегодня» не ломает ни одну вертикаль и ни один маркер.

---

## Общая приёмка (после мержа A + B + C)

1. `npm run typecheck && npm run lint && npm run test -- --run && npm run build` — всё зелёное.
2. `git diff <база>..HEAD -- src/lib/__tests__/fixtures/guest-golden.json` — **пусто**.
3. `git diff <база>..HEAD -- src/lib/__tests__/tracker.test.ts` — только добавленные строки.
4. Гость: пройти сценарий «7 млн, взнос 1,5 млн, 6%, 20 лет, бюджет 100к» — числа в выводах
   и графики совпадают со скриншотами до задачи.
5. Заведена ипотека: выдача 5 лет назад, добавлены 3 досрочки, снимок остатка и смена ставки.
6. «Открыть в калькуляторе»:
   - карточка фактов показывает **реальный** первоначальный взнос;
   - обязательный платёж = платёж из трекера, копейка в копейку;
   - на графике долга виден факт от месяца 0 с тремя точками досрочек;
   - «Что уже произошло»: 3 досрочки, их сумма, уплаченные проценты, погашенное тело;
   - «Движение денег»: столбики прошлых лет с досрочками, стык на текущем году.
7. Изменение бюджета/накоплений/горизонта пересчитывает прогноз, **не трогая** факт-фазу
   (линия факта и карточка фактов не шевелятся).
8. Горизонт 15 лет при остатке срока 7 лет — расчёт идёт, подпись про конец срока показана.
9. Таблица вычетов: годы до текущего показывают фактические проценты; хелпер в форме ипотеки
   «получено по 2025 год» → статус прошлых строк меняется на «заявлен», прогноз уменьшается.
10. Отключить сеть → перезагрузить калькулятор в режиме ипотеки → алерт вместо расчёта,
    ни одного правдоподобного, но неверного числа на экране.
11. «К моим параметрам» → гостевой сценарий целиком, факт-фаза и вертикаль «Сегодня» исчезли.
12. Сборка GitHub Pages (`TRACKER_ENABLED === false`) → калькулятор работает, ни одного
    сетевого запроса, режим ипотеки недоступен, гостевой расчёт идентичен.
13. `server/**` в диффе отсутствует.
