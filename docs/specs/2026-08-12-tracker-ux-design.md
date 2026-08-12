# Трекер → калькулятор, настройки в аккаунте, связанные поля — дизайн

Дата: 2026-08-12. Статус: к реализации. Фаза 4.
Предыдущие спеки: `docs/specs/2026-08-12-calculator-v2-design.md` (фазы 1–2),
`docs/specs/2026-08-12-tracker-design.md` (фаза 3, задеплоено).

**§4 (API-контракт) — единственный источник правды для Executor A и Executor B.**

---

## 0. Зачем

Трекер сейчас — отдельный островок: он показывает остаток и платёж, но не даёт главного —
посмотреть **свою** ипотеку в калькуляторе (графики, «копить vs гасить», цена слёта, вычеты).
Плюс три раздражителя: настройки калькулятора сбрасываются, поля стоимость/кредит/взнос
в форме ипотеки не связаны, ввод чисел ломается при удалении символов.

| WS | Суть | Зона |
|----|------|------|
| 1 | Настройки аккаунта: таблица `user_settings`, `GET/PUT /api/profile/settings` | backend |
| 2 | `GET /api/mortgages` отдаёт ипотеки **вместе с событиями** | backend |
| 3 | Режим ипотеки в калькуляторе (кнопка «Открыть в калькуляторе» + баннер + сброс) | frontend |
| 4 | Синхронизация настроек аккаунта с сервера/на сервер | frontend |
| 5 | Связанные поля цена/взнос/кредит в форме ипотеки (общий чистый хелпер) | frontend |
| 6 | Починка числового ввода (`NumericInput` с черновиком) | frontend |

Финансовая математика остаётся на фронте. Сервер по-прежнему только хранилище + авторизация.

---

## 1. Сценарии и найденные дыры

### С1 «Прикидываю ипотеку» (гость)

Работает: `useCalculatorStore` + `persist` в `localStorage`.

**Дыра G1.** Гость видит в шапке ссылку «Трекер» → `ProtectedRoute` молча редиректит на
`/login`, а `LoginPage` после входа всегда уводит на `/tracker`. Пользователь не понимает,
почему его выкинуло, и не возвращается туда, откуда пришёл.
**Решение:** `ProtectedRoute` передаёт `state: { from: location.pathname }`,
`LoginPage` после успешного входа делает `navigate(from ?? '/tracker', { replace: true })`.
Ссылка «Трекер» для неавторизованного остаётся видимой (это точка входа в продукт), но
`/login` показывает подпись «Войдите, чтобы вести свою ипотеку».

### С2 «Веду свою ипотеку» (залогинен) — **отсутствует полностью**

Нет ни кнопки, ни маппинга, ни режима. Проектируется в §2–§3.

**Дыра G2.** `MortgageCard` считает состояние как `computeMortgageState(mortgage, [], ...)` —
**без событий**, потому что `GET /api/mortgages` их не отдаёт. Пользователь видит в списке
остаток по плановому графику, который противоречит и карточке ипотеки, и «открыть
в калькуляторе». Это прямое нарушение С4.
**Решение:** список отдаёт `MortgageDetailsDto[]` (ипотека + её события), см. §4.2.
Побочная выгода: кнопка «Открыть в калькуляторе» работает прямо из карточки списка,
без дополнительного запроса.

**Дыра G3.** «Как вернуться к своим параметрам». Если просто затереть `params` данными
ипотеки, персистированный сценарий гостя уничтожается безвозвратно.
**Решение:** два набора параметров в сторе — `ownParams` (свои, персистятся) и `params`
(активные). См. §3.

**Дыра G4.** Смена пользователя в одном браузере: `logout` не чистит ни привязку к ипотеке,
ни параметры. Следующий пользователь увидит чужой «режим ипотеки #17» и получит 404/403.
**Решение:** `logout` и вход под другим `user.id` вызывают `exitMortgageMode()`.

### С3 «Предпочтения в аккаунте»

**Дыра G5 (жалоба 2).** Все параметры лежат только в `localStorage` → другое устройство,
другой браузер, очистка кэша — сброс на дефолты.
**Решение:** шесть полей, не привязанных к конкретной ипотеке, хранятся на сервере (§4.1, §5).

**Дыра G6.** Конфликт «localStorage vs сервер» не определён. Решение — §5.3.

### С4 «Обновляю факт»

Работает в пределах страницы ипотеки: после `createEvent`/`deleteEvent` идёт `load()`.

**Дыра G7.** Если бы «открыть в калькуляторе» делало снимок параметров, после новой
корректировки калькулятор показывал бы устаревшие цифры.
**Решение:** в сторе персистится **только `linkedMortgage.id`-контекст**, а сами параметры
пересчитываются из свежих данных сервера при каждом входе на страницу калькулятора (§3.3).

### Прочее в скоупе

**G8 (жалоба 3).** В `MortgageForm` поля `propertyPrice/downPayment/principal` независимы —
можно сохранить «цена 7 млн, взнос 1 млн, кредит 5 млн» и получить ипотеку, которая
не сходится сама с собой. В калькуляторе (`ParamsSection`) эти три шкалы связаны. → §6.

**G9 (жалоба 4).** Числовой ввод. → §7.

**G10.** Префилл из калькулятора (`/tracker/new`, `location.state`) не содержит `title`,
и первое, что видит пользователь после нажатия «Завести ипотеку из текущего расчёта» —
ошибку «Название обязательно». Дать дефолт `'Моя ипотека'`.

**G11.** `SliderInput` «Срок ипотеки» имеет `min={5}`, а у ипотеки в режиме трекера может
остаться 2 года. Добавить `inputMin={1}` (шкала остаётся 5–30, ручной ввод — от 1).

**G12.** При `TRACKER_ENABLED === false` (сборка GitHub Pages) синхронизация настроек и
режим ипотеки должны быть полностью выключены — ни одного сетевого запроса.

Вне скоупа (не трогаем): графики, движок, алгоритмы `tracker.ts`, деплой, CI, инфраструктура.

---

## 2. Маппинг «ипотека из трекера → MortgageParams»

Чистая функция, новый файл `src/lib/mortgageToParams.ts`, покрывается юнит-тестами.

```ts
import type { MortgageParams } from './engine'
import type { MortgageDto, MortgageEventDto } from '../api/types'
import { computeMortgageState, type MortgageState } from './tracker'

export interface MortgageModeParamsInput {
  mortgage: MortgageDto
  events: MortgageEventDto[]
  /** Настройки аккаунта (С3) — подмешиваются как есть */
  settings: AccountSettings
  today: Date
}

export interface MortgageModeParams {
  params: MortgageParams
  state: MortgageState
  /** true — monthsLeft === null, срок взят из планового графика */
  termFallback: boolean
}

export function mortgageToParams(input: MortgageModeParamsInput): MortgageModeParams
```

### Таблица соответствия

| `MortgageParams` | Источник | Комментарий |
|---|---|---|
| `apartmentPrice` | `m.propertyPrice` | нужна для имущественного вычета и для шкал |
| `downPayment` | `m.propertyPrice − state.currentBalance` (клампится в `[0, propertyPrice]`) | **синтетический**: не «взнос», а «сколько денег в квартире уже ваши» |
| `itRate` | `state.currentRate` | действующая ставка с учётом всех событий `rate` |
| `termYears` | `clamp(round(state.monthsLeft / 12), 1, 30)` | оставшийся срок |
| `freeMonthly` | `settings.freeMonthly` | С3 |
| `depositRate` | `settings.depositRate` | С3 |
| `horizonYears` | `min(settings.horizonYears, termYears)` | С3 + инвариант калькулятора |
| `keyRate` | `settings.keyRate` | С3 |
| `bankDiscount` | `settings.bankDiscount` | С3 |
| `salary` | `settings.salary` | С3 |
| `slipMonth` | не трогаем (остаётся из `ownParams`), `slipEnabled` принудительно `false` | слёт — гипотеза, а не факт |

### Допущения (пишем их в интерфейсе, в тултипе баннера)

1. **`downPayment` — синтетический.** Движок считает `loanAmount = apartmentPrice − downPayment`.
   Подставляя `downPayment = propertyPrice − остаток`, получаем ровно `loanAmount = остаток долга`.
   Проверено: имущественный вычет в `engine.ts:334` считается от `min(2 млн, apartmentPrice)`
   и от `downPayment` не зависит, поэтому подмена безопасна.
2. **Вычет по процентам завышается.** Калькулятор начинает базу 3 млн ₽ с нуля, а по идущей
   ипотеке часть базы уже израсходована. Учитывать историю процентов не будем (нет данных —
   трекер не хранит помесячную разбивку). В баннере — сноска.
3. **Срок округляется до целых лет** (`MortgageParams.termYears: number` в годах). Остаток
   32 месяца → 3 года. Из-за этого расчётный аннуитет калькулятора не совпадёт с фактическим
   платежом на несколько сотен рублей. В баннере показываем фактический платёж трекера
   (`state.currentPayment`) рядом с расчётным — чтобы расхождение было видно, а не пряталось.
   Менять `MortgageParams` на месяцы — отдельная большая задача, в этот скоуп не входит.
4. **`monthsLeft === null`** (платёж не покрывает проценты) → `termFallback = true`, срок берём
   плановый остаточный: `clamp(round((m.termMonths − прошедшие месяцы) / 12), 1, 30)`.
   Кнопку «Открыть в калькуляторе» не блокируем, но в баннере предупреждение.
5. **`currentBalance === 0`** (ипотека закрыта) → кнопка «Открыть в калькуляторе» задизейблена
   с тултипом «Ипотека погашена — считать нечего».
6. **Слёт всегда выключается** при входе в режим ипотеки. Пользователь может включить его
   вручную — это его гипотеза «а если слечу с текущей точки».

---

## 3. Режим ипотеки в калькуляторе

### 3.1. Состояние стора (`src/store/useCalculatorStore.ts`)

```ts
/** Шесть полей, которые живут в аккаунте (С3), а не в сценарии */
export const ACCOUNT_SETTING_KEYS = [
  'salary', 'depositRate', 'freeMonthly', 'horizonYears', 'keyRate', 'bankDiscount',
] as const

export interface LinkedMortgage {
  id: number
  title: string
  /** YYYY-MM-DD — дата, на которую посчитан остаток */
  asOf: string
  /** Остаток долга трекера — для баннера */
  balance: number
  /** Фактический платёж трекера — для баннера */
  payment: number
  /** true — срок взят из планового графика (см. допущение 4) */
  termFallback: boolean
}

interface CalculatorState {
  /** Активные параметры: то, что видят слайдеры и движок */
  params: MortgageParams
  /** «Свои» параметры (С1). В режиме ипотеки сохраняются нетронутыми */
  ownParams: MortgageParams
  slipEnabled: boolean
  linkedMortgage: LinkedMortgage | null
  result: CalculationResult

  setParam: <K extends keyof MortgageParams>(key: K, value: MortgageParams[K]) => void
  setSlipEnabled: (v: boolean) => void
  effectiveSlipMonth: () => number

  /** Вход/обновление режима ипотеки. Идемпотентна: повторный вызов с теми же данными — no-op по смыслу */
  enterMortgageMode: (link: LinkedMortgage, params: MortgageParams) => void
  /** Возврат к своим параметрам */
  exitMortgageMode: () => void
  /** Применить настройки аккаунта (С3), не вызывая обратного PUT */
  applyAccountSettings: (s: AccountSettings) => void
}
```

**Правило записи в `setParam`** (единственное нетривиальное место):

- ключ входит в `ACCOUNT_SETTING_KEYS` → пишем **и в `params`, и в `ownParams`**
  (бюджет/зарплата — свойства пользователя, а не сценария; правка в режиме ипотеки
  должна уехать на сервер и сохраниться);
- иначе (`apartmentPrice`, `downPayment`, `itRate`, `termYears`, `slipMonth`) → пишем в `params`,
  а в `ownParams` — **только если `linkedMortgage === null`**.

`persist`: `version: 3`, `partialize: { params, ownParams, slipEnabled, linkedMortgage }`.
`migrate` при `version < 3`: `ownParams = params ?? defaultParams`, `linkedMortgage = null`.
`onRehydrateStorage` дозаливает недостающие поля из `defaultParams` для обоих наборов.

### 3.2. Вход в режим

Кнопка **«Открыть в калькуляторе»** (иконка `IconChartLine`, `variant="light"`):

- `MortgagePage` — рядом с «Редактировать» (основная точка входа);
- `MortgageCard` — маленькая кнопка в футере карточки, `onClick` со `stopPropagation`,
  чтобы не срабатывал переход на страницу ипотеки (данные событий уже есть — см. G2).

Обработчик: `enterMortgageMode(link, params)` из `mortgageToParams(...)` → `navigate('/')`.

### 3.3. Актуализация (С4)

`CalculatorPage` при монтировании и при смене `linkedMortgage.id`:

```
если !TRACKER_ENABLED или !isAuthenticated или linkedMortgage === null → ничего
иначе:
  GET /api/mortgages/{linkedMortgage.id}
    ok      → mortgageToParams(...) → enterMortgageMode(...)   // перезаписывает params свежими
    404     → exitMortgageMode() + notification «Ипотека удалена, вернулись к вашим параметрам»
    прочее  → оставляем как есть, в баннере пометка «данные могли устареть»
```

Следствие, которое фиксируем явно: **правки слайдеров в режиме ипотеки живут до ухода
со страницы калькулятора.** Это «что если» поверх фактического состояния, а не второй
персистируемый сценарий. Постоянные изменения делаются корректировкой в трекере.
Исключение — шесть полей аккаунта: они переживают перезагрузку, потому что берутся
из настроек, а не из ипотеки.

### 3.4. Баннер (`src/components/calculator/MortgageModeBanner.tsx`)

Рендерится в `CalculatorPage` над `ParamsSection`, только когда `linkedMortgage !== null`.

```
┌────────────────────────────────────────────────────────────────────────┐
│ [badge «Режим ипотеки»]  Квартира на Ленина                            │
│ Остаток 4 120 000 ₽ · ставка 6,0% · платёж 41 800 ₽/мес · на 12.08.2026│
│ Расчётный платёж калькулятора 41 350 ₽/мес — срок округлён до лет ⓘ    │
│                          [Открыть в трекере]  [К моим параметрам]      │
└────────────────────────────────────────────────────────────────────────┘
```

- `Alert color="blue" variant="light"`;
- ⓘ — `InfoTooltip` с допущениями 2 и 3 из §2;
- при `termFallback` — жёлтый вариант и строка «Текущий платёж не покрывает проценты,
  срок взят из договора»;
- «К моим параметрам» → `exitMortgageMode()`;
- кнопка «Завести ипотеку из текущего расчёта» в `CalculatorPage` в режиме ипотеки
  **скрывается** (иначе плодятся дубликаты одной и той же ипотеки).

---

## 4. API-контракт (источник правды)

### 4.1. Настройки аккаунта

`GET /api/profile/settings` — требует Bearer.

```
200 OK
{
  "version": 1,
  "settings": {                 // null, если пользователь ещё ничего не сохранял
    "salary": 350000,           // number | null
    "depositRate": 16,
    "freeMonthly": 100000,
    "horizonYears": 10,
    "keyRate": 16,
    "bankDiscount": 0.5
  },
  "updatedAt": "2026-08-12T10:15:00Z"   // string | null
}
```

`PUT /api/profile/settings` — требует Bearer.

```
Request
{
  "version": 1,
  "settings": { …те же шесть полей, все обязательны кроме salary… }
}

200 OK — тот же объект, что отдаёт GET (с проставленным updatedAt)
400 { "error": "…" } — версия не 1 или значение вне диапазона
```

Валидация (текст ошибок — русский, как в `Requests.cs`):

| Поле | Диапазон | Ошибка |
|---|---|---|
| `version` | `= 1` | `Неподдерживаемая версия настроек` |
| `salary` | `null` или `0 … 10 000 000` | `Зарплата должна быть от 0 до 10 000 000` |
| `depositRate` | `0 … 100` | `Доходность должна быть от 0 до 100 процентов` |
| `freeMonthly` | `0 … 50 000 000` | `Бюджет должен быть от 0 до 50 000 000` |
| `horizonYears` | `1 … 30` | `Горизонт должен быть от 1 до 30 лет` |
| `keyRate` | `0 … 100` | `Ключевая ставка должна быть от 0 до 100 процентов` |
| `bankDiscount` | `−10 … 10` | `Дисконт банка должен быть от -10 до 10` |

Семантика PUT — **полная замена** (не merge). `settings: null` в теле PUT → 400.

### 4.2. Список ипотек — изменение формата

`GET /api/mortgages` теперь отдаёт ипотеки вместе с событиями (дыра G2):

```
200 OK
[
  { "mortgage": { …MortgageDto… }, "events": [ …MortgageEventDto… ] },
  …
]
```

То есть `MortgageDetailsDto[]` — та же форма, что у `GET /api/mortgages/{id}`.
Порядок ипотек не меняется (`started_on DESC, id DESC`), события внутри —
`occurred_on ASC, id ASC`. Это **ломающее** изменение контракта; A и B выкатывают его
в одном релизе.

Остальные семь маршрутов ипотек/событий — без изменений.

---

## 5. Серверное хранение настроек

### 5.1. Миграция `002_user_settings.sql`

```sql
CREATE TABLE IF NOT EXISTS user_settings (
    user_id    BIGINT UNSIGNED NOT NULL,
    version    INT             NOT NULL DEFAULT 1,
    data       JSON            NOT NULL,
    updated_at DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id),
    CONSTRAINT fk_user_settings_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

Одна строка на пользователя, JSON-блоб + `version` — добавление седьмого поля не потребует
миграции схемы, только правки DTO и бампа версии.

**Внимание Executor A:** `MigrationRunner.SplitSqlStatements` режет файл по `;` и вырезает
`--`-комментарии. В миграции не должно быть ни `;` внутри строковых литералов, ни хранимых
процедур. Приведённый DDL этому удовлетворяет.

### 5.2. Слой доступа

`Data/UserSettingsRepository.cs`:

```csharp
Task<UserSettingsRow?> GetAsync(ulong userId);
Task<UserSettingsRow> UpsertAsync(ulong userId, int version, string dataJson);
```

Upsert: `INSERT … ON DUPLICATE KEY UPDATE version = VALUES(version), data = VALUES(data)`.
DTO ↔ JSON — через `System.Text.Json` теми же `JsonSerializerOptions`, что и остальной API
(camelCase). Типизированный DTO на проводе + JSON в колонке: контракт явный и валидируемый,
схема эволюционирует дёшево.

`Endpoints/ProfileEndpoints.cs` — `app.MapProfileEndpoints()`, группа `/api/profile`,
защищена `FallbackPolicy` (явный `RequireAuthorization()` не нужен), регистрируется
в `Program.cs` рядом с `MapMortgageEndpoints()`.

### 5.3. Порядок «localStorage vs сервер» на фронте

Компонент-синхронизатор `<AccountSettingsSync />` монтируется в `Shell` (`src/App.tsx`),
работает только при `TRACKER_ENABLED && isAuthenticated`.

**При появлении/смене `user.id`:**

1. `GET /api/profile/settings`.
2. `settings === null` (первый вход этого пользователя) → **сеять**: берём текущие шесть
   значений из `ownParams` и делаем `PUT`. Локальные настройки гостя мигрируют в аккаунт,
   пользователь ничего не теряет.
3. `settings !== null` → **сервер побеждает**: `applyAccountSettings(server)`. Локальные
   значения этих шести полей затираются. Обоснование — С3 дословно: «не сбрасываются
   между заходами/устройствами»; аккаунт обязан быть источником правды, иначе устройство
   с устаревшим `localStorage` откатывает настройки.
4. Ошибка сети → работаем на локальных значениях, `PUT`-и не отправляем до успешного `GET`
   (флаг `loaded`), один автоматический повтор через 5 с.

**При изменении любого из шести полей** (подписка на стор, сравнение только по
`ACCOUNT_SETTING_KEYS`): дебаунс **800 мс** → `PUT`. Отправляется всегда весь набор.
Гонок нет: ключ — `user_id`, семантика — полная замена, последний писатель выигрывает.
Ошибка `PUT` → один повтор через 3 с, затем `notification` «Не удалось сохранить настройки»
(один раз на сессию, не спамим).

**При `logout`:** `exitMortgageMode()`; шесть полей остаются в `localStorage` как есть —
гость продолжает с тем, что видел. Сброса на дефолты нет.

**При входе под другим `user.id`:** `exitMortgageMode()`, затем шаги 1–3.

---

## 6. Связанные поля цена / взнос / кредит

Новый чистый модуль `src/lib/loanLink.ts` — общая логика для калькулятора и формы ипотеки.

```ts
export interface LoanTriple {
  propertyPrice: number
  downPayment: number
  principal: number
}
export type LoanField = keyof LoanTriple

/** Инвариант на выходе всегда: principal === propertyPrice − downPayment, все ≥ 0 */
export function relinkLoan(prev: LoanTriple, field: LoanField, value: number): LoanTriple
```

Правила (ровно те, что уже работают в `ParamsSection`, вынесенные из компонента):

| Меняем | Что происходит |
|---|---|
| `propertyPrice` | сохраняется **доля** взноса: `pct = prev.downPayment / prev.propertyPrice` (при `prev.propertyPrice === 0` → `0.2`); `downPayment = round(pct × price)`; `principal = price − downPayment` |
| `downPayment` | `downPayment = clamp(v, 0, price)`; `principal = price − downPayment` |
| `principal` | `principal = clamp(v, 0, price)`; `downPayment = price − principal` |

Применение:

- `ParamsSection` — заменяет `handleApartmentPrice` / `handleDownPayment` / `handleLoanAmount`
  на вызовы `relinkLoan`. Поведение не меняется (регрессия проверяется тестами).
  Важно: два `setParam` подряд вызывают два пересчёта движка — заменить на один
  `setParams(patch)` (новый батч-экшен стора) или оставить как есть; предпочтительно батч.
- `MortgageForm` — три поля становятся связанными по тем же правилам. Валидация
  «взнос < цены» и «кредит ≤ цены» после этого не может сработать в норме, но остаётся
  как страховка (сервер валидирует те же правила).

Побочный эффект: `principal` в форме перестаёт быть свободным. Это осознанно — в договоре
ипотеки эти три числа всегда связаны, а расхождение делает данные трекера бессмысленными.

---

## 7. Починка числового ввода (жалоба 4)

### 7.1. Причина

`@mantine/core@7.17.8`, `NumberInput.mjs`:

```js
setValue(
  isValidNumber(payload.floatValue, payload.value)
    && !leadingDecimalZeroPattern.test(payload.value)
    && !(allowLeadingZeros ? leadingZerosPattern.test(payload.value) : false)
      ? payload.floatValue      // number
      : payload.value           // ← СТРОКА
)
```

`onChange` получает **строку**, когда введённое не парсится в число или начинается с нулей
(`allowLeadingZeros` по умолчанию `false`). Удаление «1» из «1 000 000» даёт ровно этот
случай: сырое значение `"000000"` → в `onChange` уходит строка.

Дальше:

- `MortgageForm`: `onChange={(v) => setPropertyPrice(typeof v === 'number' ? v : '')}` →
  `''` → **поле очищается полностью**. Это и есть репортнутый баг.
- `SliderInput.commitInput`: `parseFloat("000000") === 0` → клампится до `min`
  → **поле прыгает на минимум**.

Второй дефект того же корня: `commitInput` клампит **на каждом нажатии**, тогда как у самого
Mantine `clampBehavior` по умолчанию `'blur'`. В поле «Стоимость квартиры» (`min = 1 000 000`)
нельзя набрать `5 000 000` с нуля — первый же символ `5` превращается в `1 000 000`.

### 7.2. Решение — `src/components/controls/NumericInput.tsx`

Обёртка над `NumberInput` с локальным черновиком: промежуточные состояния редактирования
живут внутри и наружу не выходят, коммит — по валидному вводу или по `blur`.

```tsx
interface NumericInputProps {
  value: number | null
  onChange: (v: number | null) => void
  min?: number
  max?: number
  /** true — пустое поле валидно и коммитит null (зарплата, платёж по договору) */
  allowEmpty?: boolean
  // + прокидываемые: label, step, suffix, thousandSeparator, decimalScale,
  //   placeholder, description, size, styles, hideControls
}
```

Поведение:

1. Локально: `draft: number | string`, `focused: boolean`.
2. `value` из пропсов синхронизируется в `draft` только когда `focused === false`
   (внешние изменения не дёргают курсор при наборе).
3. `<NumberInput value={focused ? draft : (value ?? '')} clampBehavior="none" … />` —
   клампинг Mantine отключён, им управляем мы.
4. `onChange(v)` из Mantine: `setDraft(v)` **всегда**; наружу `onChange(v)` уходит, только
   если `typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi` — то есть
   графики двигаются вживую, но мусорные промежуточные состояния их не трогают.
5. `onBlur`: `setFocused(false)`, затем коммит —
   - `draft` пустой: `allowEmpty ? onChange(null) : ` откат (эффект из п. 2 вернёт `value`);
   - иначе `onChange(clamp(parse(draft), lo, hi))`.
6. `onFocus`: `setFocused(true)`.

Замены:

- `SliderInput` — `NumberInput` → `NumericInput`, `commitInput` удаляется целиком
  (клампинг переезжает в `NumericInput`);
- `MortgageForm` — все пять числовых полей;
- `ParamsSection` — поле «Зарплата до налогов» (`allowEmpty`, `0` → `null`);
- `EventForm` — числовые поля (тот же баг).

### 7.3. Приёмочные проверки (vitest + `@testing-library/user-event`)

1. Поле со значением `1000000`, `min = 1000000`: курсор в начало, `Backspace` →
   наружу не ушло ни `''`, ни `0`, отображается ввод пользователя; после `blur` значение
   `1000000` (клампится).
2. Пустое поле, `min = 1000000`: набор `5000000` посимвольно → на каждом шаге поле
   принимает символ; после `blur` наружу ушло `5000000`.
3. `allowEmpty`, поле очищено → `blur` → `onChange(null)`.
4. Ввод `12345678901` при `max = 10000000` → `blur` → `10000000`.

---

## 8. Что НЕ делаем

- `MortgageParams.termYears` в месяцах (нужен рефактор движка и всех графиков).
- История помесячно уплаченных процентов для точного вычета.
- Мультиустройственное разрешение конфликтов настроек (last-write-wins достаточно).
- Хранение сценариев калькулятора на сервере — в аккаунте живут только шесть предпочтений.
- Серверный расчёт остатка/платежа — вся математика остаётся на фронте.
