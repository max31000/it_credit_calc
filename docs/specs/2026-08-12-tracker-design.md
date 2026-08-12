# Трекер ипотеки + опциональный слёт — дизайн

Дата: 2026-08-12. Статус: к реализации.
Предыдущая спека: `docs/specs/2026-08-12-calculator-v2-design.md` (фазы 1–2, сделано).
Это фаза 3 + workstream 0.

## 0. Что делаем

| WS | Суть |
|----|------|
| 0 | Сценарий слёта по умолчанию выключен (тумблер в `SlipSection`) |
| 1 | Бэкенд: .NET 8 minimal API + MySQL + Telegram-авторизация, в этом же репозитории (`server/`) |
| 2 | Фронт: роутинг, логин, список ипотек, карточка ипотеки, корректировки |
| 3 | Инфра: nginx-прокси внутри фронт-контейнера, docker-compose на VDS, CI на два образа |

Расчёт «сколько осталось» делает **фронт** существующим движком. Сервер — только хранилище
и авторизация, никакой финансовой математики на бэкенде.

---

## 1. Workstream 0 — слёт опционален

### Решение: отдельный флаг `slipEnabled` в сторе, вне `params`

Альтернатива (выводить `slipEnabled` из `slipMonth > 0`) отвергнута: выключение тумблера
стирало бы выбранный месяц, при включении пользователь получал бы не своё значение.

`src/store/useCalculatorStore.ts`:

```ts
interface CalculatorState {
  params: MortgageParams          // slipMonth здесь — «запомненная» позиция слайдера
  slipEnabled: boolean            // default false
  result: CalculationResult
  setParam: ...
  setSlipEnabled: (v: boolean) => void
  effectiveSlipMonth: () => number   // slipEnabled ? params.slipMonth : 0
}
```

- В движок всегда уходит `{ ...params, slipMonth: slipEnabled ? params.slipMonth : 0 }`.
  Пересчёт — и в `setParam`, и в `setSlipEnabled` (общий хелпер `recalc(state)`).
- `defaultParams.slipMonth` остаётся **36** — это запомненная позиция слайдера, а не вход движка.
  Требование «дефолт slipMonth = 0» выполняется на входе движка: при `slipEnabled: false`
  `calculate()` получает `slipMonth: 0` и возвращает `slip: null`.
- Persist: `version: 2`, `partialize: { params, slipEnabled }`,
  `migrate(persisted, v)`: при `v < 2` → `slipEnabled = false` (всем, независимо от
  сохранённого `slipMonth`) — старое значение 36 пришло из дефолта, а не из осознанного выбора.
  `onRehydrateStorage` продолжает дозаливать недостающие поля из `defaultParams`.

### UI

- `SlipSection`: `<Switch>` в шапке карточки, подпись «Моделировать слёт с льготной программы».
- При выключенном — слайдеры (месяц слёта, ключевая ставка, дисконт) и строка
  «Рыночная ставка после слёта» скрыты через `<Collapse in={slipEnabled}>`; заголовок и
  краткое описание остаются, карточка не «прыгает» в разметке.
- Везде, где компонент имеет в виду «слёт, который реально моделируется», используется
  `effectiveSlipMonth()`, а не `params.slipMonth`. Затронутые места:
  - `ChartsSection.tsx:59`, `118` — `showSlip` (уже завязан на `result.slip !== null`, но
    второй операнд `params.slipMonth > 0` надо заменить);
  - `ChartsSection.tsx:71,73`, `128,130` — `ReferenceLine x={...}`;
  - `ChartsSection.tsx:239,241` — `ReferenceLine` в `SlipRiskTab`;
  - `InsightsSection.tsx:184` — заголовок «Сколько стоит слёт в месяц N».
  - Вкладка «Риск слёта» (`slipAnalysis`) остаётся видимой всегда — это анализ гипотетических
    слётов, он не зависит от тумблера.
- `SliderInput` «Месяц слёта» сохраняет `min={0}` — 0 остаётся валидным значением внутри
  включённого сценария.

---

## 2. Схема БД (MySQL 8, utf8mb4)

Одна миграция `001_init.sql`, применяется `MigrationRunner`-ом на старте API
(таблица учёта `_migrations`, как в bonds).

```sql
CREATE TABLE IF NOT EXISTS users (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    telegram_id BIGINT          NOT NULL,
    username    VARCHAR(255)    NULL,
    first_name  VARCHAR(255)    NULL,
    last_name   VARCHAR(255)    NULL,
    photo_url   VARCHAR(512)    NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_telegram_id (telegram_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mortgages (
    id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         BIGINT UNSIGNED NOT NULL,
    title           VARCHAR(120)    NOT NULL,
    bank            VARCHAR(120)    NULL,
    property_price  DECIMAL(15,2)   NOT NULL,
    down_payment    DECIMAL(15,2)   NOT NULL,
    principal       DECIMAL(15,2)   NOT NULL,   -- сумма кредита на дату выдачи
    rate            DECIMAL(6,3)    NOT NULL,   -- годовая ставка на дату выдачи, %
    term_months     INT             NOT NULL,
    started_on      DATE            NOT NULL,
    monthly_payment DECIMAL(15,2)   NULL,       -- аннуитет из договора; NULL → считает фронт
    created_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_mortgages_user (user_id, id),
    CONSTRAINT fk_mortgages_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS mortgage_events (
    id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    mortgage_id BIGINT UNSIGNED NOT NULL,
    kind        VARCHAR(16)     NOT NULL,   -- balance | rate | prepayment | payment
    occurred_on DATE            NOT NULL,
    amount      DECIMAL(15,2)   NULL,
    rate        DECIMAL(6,3)    NULL,
    note        VARCHAR(500)    NULL,
    created_at  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY ix_events_mortgage (mortgage_id, occurred_on, id),
    CONSTRAINT fk_events_mortgage FOREIGN KEY (mortgage_id) REFERENCES mortgages(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

`kind` — VARCHAR + валидация в API (не ENUM: добавление вида не требует ALTER).

| kind | смысл | обязательные поля |
|------|-------|-------------------|
| `balance` | фактический остаток долга из выписки банка | `amount` > 0, `rate` = null |
| `rate` | смена ставки (в т.ч. слёт с льготы) | `rate` в (0; 100], `amount` = null |
| `prepayment` | досрочный платёж | `amount` > 0, `rate` = null |
| `payment` | новый размер обязательного платежа | `amount` > 0, `rate` = null |

Удаление ипотеки — физическое, события уходят каскадом.

---

## 3. API-контракт

**Единственный источник правды для Executor A и Executor B.**

База: `/api` внутри контейнера, снаружи `https://mvv42.ru/credit_calc/api/*`
(nginx фронт-контейнера срезает префикс `/credit_calc`).

JSON: camelCase, `JsonStringEnumConverter` с camelCase, даты — `YYYY-MM-DD` (`DateOnly`),
таймстемпы — ISO-8601 UTC. Ошибка всегда `{ "error": "текст на русском" }`.

Коды: `200` / `201` / `204` / `400` (валидация) / `401` (нет/протух токен) / `404`
(нет объекта **или он чужой**) / `500`.

### 3.1 Публичные

#### `GET /health`
```json
{ "status": "ok" }
```

#### `POST /api/auth/telegram`
Запрос (поля из Telegram Login Widget, переименованные в camelCase на фронте):
```json
{
  "id": 123456789,
  "firstName": "Максим",
  "lastName": null,
  "username": "maksim",
  "photoUrl": "https://t.me/i/userpic/320/xxx.jpg",
  "authDate": 1786000000,
  "hash": "a1b2c3..."
}
```
Ответ `200`:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": { "id": 1, "telegramId": 123456789, "username": "maksim", "firstName": "Максим", "lastName": null }
}
```
`401` — подпись не сошлась или `authDate` старше 24 часов.
**Allowlist отсутствует**: любой пользователь Telegram логинится и ведёт свои ипотеки
(в отличие от bonds, где стоит `Telegram:OwnerId`). При первом входе создаётся строка в
`users`, при повторном — обновляются имя/username/photo.

### 3.2 Защищённые (`Authorization: Bearer <token>`)

#### `GET /api/auth/me`
```json
{ "id": 1, "telegramId": 123456789, "username": "maksim", "firstName": "Максим", "lastName": null }
```

#### `GET /api/mortgages`
```json
[
  {
    "id": 12,
    "title": "Квартира на Ленина",
    "bank": "Сбер",
    "propertyPrice": 7000000.00,
    "downPayment": 1470000.00,
    "principal": 5530000.00,
    "rate": 6.000,
    "termMonths": 240,
    "startedOn": "2025-03-15",
    "monthlyPayment": 39620.50,
    "createdAt": "2026-08-12T10:00:00Z",
    "updatedAt": "2026-08-12T10:00:00Z"
  }
]
```
Сортировка: `started_on DESC, id DESC`.

#### `POST /api/mortgages` → `201` + `Location: /api/mortgages/{id}`
Запрос:
```json
{
  "title": "Квартира на Ленина",
  "bank": "Сбер",
  "propertyPrice": 7000000,
  "downPayment": 1470000,
  "principal": 5530000,
  "rate": 6,
  "termMonths": 240,
  "startedOn": "2025-03-15",
  "monthlyPayment": 39620.5
}
```
Ответ — `MortgageDto` (как в списке).

Валидация (`400` при нарушении):
`title` 1..120 непустой; `bank` ≤ 120 или null; `propertyPrice` > 0; `downPayment` ≥ 0 и
< `propertyPrice`; `principal` > 0 и ≤ `propertyPrice`; `rate` в (0; 100]; `termMonths` в
[1; 600]; `startedOn` не позже сегодня + 1 день; `monthlyPayment` > 0 или null.

#### `GET /api/mortgages/{id}`
Отдаёт ипотеку **вместе с историей** — фронту для расчёта нужно и то, и другое:
```json
{
  "mortgage": { "...": "MortgageDto" },
  "events": [
    {
      "id": 44,
      "mortgageId": 12,
      "kind": "balance",
      "occurredOn": "2026-08-01",
      "amount": 5100000.00,
      "rate": null,
      "note": "выписка из банка",
      "createdAt": "2026-08-12T10:05:00Z"
    },
    {
      "id": 45,
      "mortgageId": 12,
      "kind": "rate",
      "occurredOn": "2026-09-01",
      "amount": null,
      "rate": 17.500,
      "note": "слёт с льготной программы",
      "createdAt": "2026-08-12T10:06:00Z"
    }
  ]
}
```
`events` отсортированы `occurred_on ASC, id ASC`.

#### `PUT /api/mortgages/{id}`
Тело и валидация — как у `POST`. Ответ `200` + обновлённый `MortgageDto`.

#### `DELETE /api/mortgages/{id}` → `204`

#### `GET /api/mortgages/{id}/events` → массив `MortgageEventDto`

#### `POST /api/mortgages/{id}/events` → `201` + `MortgageEventDto`
```json
{ "kind": "prepayment", "occurredOn": "2026-07-20", "amount": 300000, "rate": null, "note": "премия" }
```
Валидация: `kind` ∈ {`balance`,`rate`,`prepayment`,`payment`}; заполненность `amount`/`rate`
по таблице §2; `occurredOn` ≥ `mortgage.startedOn` и ≤ сегодня + 1 год; `note` ≤ 500.

#### `DELETE /api/mortgages/{id}/events/{eventId}` → `204`

---

## 4. Структура бэкенда

Масштабировано вниз относительно bonds: **два проекта вместо четырёх**, без слоёв
Core/Infrastructure, без репозиториев за интерфейсами (Dapper-классы конкретные,
подменять нечего).

```
server/
  CreditCalc.sln
  Dockerfile                        # context = ./server
  src/CreditCalc.Api/
    CreditCalc.Api.csproj           # net8.0; Dapper, MySqlConnector,
                                    # Microsoft.AspNetCore.Authentication.JwtBearer,
                                    # System.IdentityModel.Tokens.Jwt
    Program.cs                      # DI, JWT, FallbackPolicy, миграции на старте, Map*Endpoints
    appsettings.json                # dev-дефолты
    appsettings.Production.json     # без секретов — всё через ENV
    Auth/
      TelegramAuthData.cs           # record запроса
      TelegramAuthService.cs        # HMAC-SHA256 проверка подписи (порт из bonds)
      JwtIssuer.cs                  # выпуск токена + чтение userId из ClaimsPrincipal
    Contracts/
      Dtos.cs                       # MortgageDto, MortgageEventDto, UserDto, MortgageDetailsDto
      Requests.cs                   # MortgageRequest, MortgageEventRequest + Validate()
    Data/
      Db.cs                         # фабрика MySqlConnection из IConfiguration
      UserRepository.cs
      MortgageRepository.cs         # все методы принимают userId
      MortgageEventRepository.cs    # все методы принимают userId (JOIN mortgages)
      MigrationRunner.cs            # порт из bonds, embedded .sql
      Migrations/001_init.sql       # EmbeddedResource
    Endpoints/
      AuthEndpoints.cs
      MortgageEndpoints.cs          # ипотеки + вложенные события
    Middleware/ErrorHandlingMiddleware.cs
  tests/CreditCalc.Api.Tests/
    CreditCalc.Api.Tests.csproj     # xunit, FluentAssertions, Microsoft.AspNetCore.Mvc.Testing
    TelegramAuthServiceTests.cs
    MigrationRunnerTests.cs         # SplitSqlStatements
    ValidationTests.cs              # MortgageRequest/MortgageEventRequest
    JwtIssuerTests.cs
    HealthSmokeTests.cs             # WebApplicationFactory, env Testing (без БД)
```

### Решения

- **Тесты без Docker.** В отличие от bonds, интеграционных тестов на Testcontainers нет:
  проект маленький, а `dotnet test` должен проходить локально и в CI без поднятого демона.
  SQL проверяется смоук-запросом после деплоя. Миграции пропускаются при
  `ASPNETCORE_ENVIRONMENT=Testing` (как в bonds), поэтому `HealthSmokeTests` не требует БД.
- **`global.json` не заводим.** Локально стоят SDK 8.0.422/9/10 — SDK 10 корректно собирает
  `net8.0`. В CI — `actions/setup-dotnet@v4` с `8.0.x`.
- Порт API — **8080** (`ASPNETCORE_URLS=http://+:8080`), наружу не публикуется.
- Конфиг из ENV с двойным подчёркиванием: `ConnectionStrings__DefaultConnection`,
  `Jwt__Secret`, `Telegram__BotToken`.
- Swagger только в Development.
- CORS: разрешён только `http://localhost:5173` (dev). В проде фронт и API — один origin,
  CORS не участвует.

---

## 5. Безопасность

1. **JWT HS256**, `Jwt:Secret` ≥ 32 символа из ENV. Claims: `sub` = `users.id`,
   `telegram_id`. Issuer/Audience = `credit_calc`, срок 30 дней, `ClockSkew` 30 сек.
2. **`FallbackPolicy = RequireAuthenticatedUser()`** — любой новый эндпоинт защищён по
   умолчанию. Анонимны только `GET /health` и `POST /api/auth/telegram` (явный
   `.AllowAnonymous()`).
3. **Проверка владения — в SQL, не в коде эндпоинта.** Каждый запрос к `mortgages` содержит
   `WHERE ... AND user_id = @UserId`; каждый запрос к `mortgage_events` —
   `JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId`. Отдельного
   «if (mortgage.UserId != userId)» нет — забыть его негде.
4. **Чужой или несуществующий объект → `404`**, не `403`: не раскрываем факт существования.
5. `userId` берётся **только** из `ClaimsPrincipal`; ни один эндпоинт не принимает
   `userId` из тела/query.
6. Telegram: HMAC-SHA256 по отсортированному `data_check_string`, `secret_key = SHA256(bot_token)`,
   сравнение через `CryptographicOperations.FixedTimeEquals`, отказ при `auth_date` старше 24 ч.
7. Секреты только в `.env` на VDS (генерируется деплой-шагом из GitHub secrets, режим `600`),
   в репозитории — плейсхолдеры. `.env` уже в `.gitignore`.
8. MySQL не публикует порт на хост; API не публикует порт; наружу смотрит только
   `127.0.0.1:8081` фронта.
9. Токен на фронте — в `localStorage` (`credit-calc-auth`), как в bonds. Осознанный
   компромисс: сервис личный, XSS-поверхность — собственный SPA без пользовательского HTML.

---

## 6. Фронт: роутинг и состояния

### Роутинг

`react-router-dom` v7, `<BrowserRouter basename={import.meta.env.BASE_URL}>`
(`/credit_calc/` на VDS, `/it_credit_calc/` на Pages).

| Путь | Экран | Доступ |
|------|-------|--------|
| `/` | Калькулятор (текущий контент `App.tsx`) | всегда |
| `/login` | Telegram Login Widget | только при `TRACKER_ENABLED` |
| `/tracker` | Список своих ипотек + кнопка «Завести» | требует токен |
| `/tracker/:id` | Карточка ипотеки: статус, история, корректировки | требует токен |
| `*` | редирект на `/` | — |

### Флаг доступности трекера

```ts
export const API_BASE = import.meta.env.VITE_API_BASE ?? ''
export const TRACKER_ENABLED = API_BASE !== ''
```

- VDS: образ собирается с `--build-arg VITE_API_BASE=/credit_calc/api`.
- GitHub Pages: сборка идёт с `VITE_API_BASE=''` → трекер полностью скрыт.
- Локально: `.env.development` с `VITE_API_BASE=/credit_calc/api` + `server.proxy` в
  `vite.config.ts` (`^/credit_calc/api` → `http://localhost:8080/api`).

### Состояния

| Состояние | Header | `/tracker` |
|-----------|--------|-----------|
| Pages-режим (`!TRACKER_ENABLED`) | ссылки «Трекер» нет | `<Navigate to="/" replace>` |
| Гость (токена нет) | кнопка «Войти» | `<Navigate to="/login" replace>` |
| Залогинен | имя + «Выйти» | список ипотек |
| Токен протух (401 от API) | — | `logout()` + переход на `/login` |

Калькулятор работает во всех состояниях без изменений — трекер это надстройка,
а не гейт.

### Расчёт «осталось» — `src/lib/tracker.ts` (чистая функция, покрыта тестами)

```ts
export interface MortgageState {
  currentBalance: number      // остаток долга на сегодня
  currentRate: number         // действующая ставка, % годовых
  currentPayment: number      // действующий обязательный платёж
  monthsLeft: number | null   // null — платежа не хватает даже на проценты
  payoffDate: string | null   // YYYY-MM
  paidPrincipal: number       // погашено тела
  progressPct: number         // paidPrincipal / principal
  asOf: string                // дата расчёта
}
export function computeMortgageState(m: MortgageDto, events: MortgageEventDto[], today: Date): MortgageState
```

Алгоритм:
1. **Якорь** — последнее событие `balance` с `occurredOn ≤ today`; если его нет — `principal`
   на дату `startedOn`.
2. **Ставка** — последнее `rate` с `occurredOn ≤ today`, иначе `mortgage.rate`.
3. **Платёж** — последнее `payment` с `occurredOn ≤ today`, иначе `mortgage.monthlyPayment`,
   иначе `calcPMT(principal, rate/1200, termMonths)` (импорт из `lib/engine.ts`).
4. Прокрутка по месяцам от якоря до `today`: начисление процентов, вычитание платежа,
   вычитание `prepayment`-событий месяца, применение `rate`/`payment`-событий с этого месяца.
5. `monthsLeft` — число месяцев до обнуления остатка при текущих ставке и платеже;
   `null`, если `payment ≤ balance * rate/1200` (долг не убывает — UI показывает предупреждение).

Событие `balance` — «истина от банка»: обнуляет накопленную ошибку прокрутки.

### Компоненты (новые)

```
src/api/            client.ts, auth.ts, mortgages.ts, types.ts
src/store/          useAuthStore.ts
src/pages/          CalculatorPage.tsx, LoginPage.tsx, TrackerListPage.tsx, MortgagePage.tsx
src/components/tracker/  MortgageForm.tsx, MortgageCard.tsx, MortgageStatus.tsx,
                         EventForm.tsx, EventList.tsx
src/lib/            tracker.ts (+ __tests__/tracker.test.ts)
```

`MortgageForm` умеет предзаполниться из калькулятора: `propertyPrice ← apartmentPrice`,
`downPayment`, `principal ← result.loanAmount`, `rate ← itRate`,
`termMonths ← termYears * 12`, `monthlyPayment ← result.minPayment`, `startedOn ← сегодня`.
Кнопка «Завести из текущего расчёта» — на странице калькулятора (видна при
`TRACKER_ENABLED` и наличии токена).

---

## 7. Инфраструктура

### 7.1 nginx внутри фронт-контейнера

VDS-nginx не трогаем — он уже проксирует `/credit_calc/` на `127.0.0.1:8081`.
В `nginx.conf` репозитория добавляется блок **выше** SPA-локации:

```nginx
location /credit_calc/api/ {
    resolver 127.0.0.11 valid=10s ipv6=off;   # docker DNS; имя резолвится в рантайме,
    set $api http://credit_calc_api:8080;      # а не при старте nginx
    rewrite ^/credit_calc/api/(.*)$ /api/$1 break;
    proxy_pass $api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
}
```

Префиксная локация `/credit_calc/api/` длиннее `/credit_calc/` и выигрывает; regex-локации
для `.js/.css/.png` не конфликтуют (у API нет таких расширений).

### 7.2 docker-compose на VDS

`deploy/docker-compose.prod.yml` (копируется на VDS через scp, поднимается `docker compose up -d`):

| Сервис | Образ | Порты | Сеть |
|--------|-------|-------|------|
| `credit_calc` | `ghcr.io/max31000/it_credit_calc:latest` | `127.0.0.1:8081:80` | `credit_calc_net` |
| `credit_calc_api` | `ghcr.io/max31000/it_credit_calc-api:latest` | нет | `credit_calc_net` |
| `credit_calc_mysql` | `mysql:8.0` | нет | `credit_calc_net` |

- Volume `credit_calc_mysql_data` — именованный, переживает передеплой.
- `credit_calc_mysql` с healthcheck (`mysqladmin ping`), `credit_calc_api` ждёт
  `condition: service_healthy`, `credit_calc` — `depends_on: credit_calc_api`.
- Переменные подставляются из `.env` рядом с compose-файлом (`JWT_SECRET`,
  `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD`, `TELEGRAM_BOT_TOKEN`).
- **Одноразовое:** на VDS уже крутится контейнер `credit_calc`, запущенный через `docker run`.
  Деплой-скрипт делает `docker rm -f credit_calc || true` перед `compose up` (идемпотентно).

### 7.3 CI (`.github/workflows/deploy.yml`)

```
test-web ─┐
test-api ─┼→ build-web ─┐
          └→ build-api ─┴→ deploy
test-web ──→ pages
```

- `test-web`: npm ci → test → typecheck → lint.
- `test-api`: `actions/setup-dotnet@v4` (`8.0.x`) → restore/build/test `server/CreditCalc.sln`.
- `build-web`: образ `ghcr.io/max31000/it_credit_calc`, `build-args: VITE_API_BASE=/credit_calc/api`.
- `build-api`: образ `ghcr.io/max31000/it_credit_calc-api`, context `./server`, file `server/Dockerfile`.
- `deploy`: scp `deploy/docker-compose.prod.yml` → генерация `.env` (chmod 600) →
  `docker compose pull && up -d` → health-чеки → `docker image prune -f`.
- `pages`: **сейчас Pages не деплоится** — workflow `deploy-ghp.yml` удалён в коммите 3900087,
  ветка `gh-pages` заморожена на апреле, README про Pages устарел. Job восстанавливается
  (рецепт — в плане, `peaceiris/actions-gh-pages@v4`, `VITE_BASE_PATH=/it_credit_calc/`,
  `VITE_API_BASE=''`).

### 7.4 Секреты GitHub

| Секрет | Статус |
|--------|--------|
| `GHCR_PAT`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `VDS_HOST`, `VDS_USER`, `VDS_SSH_PRIVATE_KEY` | есть |
| `JWT_SECRET`, `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` | создаёт оркестратор через `gh secret set` |

Бот — существующий `mv_cashpulse_bot`, домен `mvv42.ru` к нему уже привязан;
второй домен для виджета не нужен. На GitHub Pages логин не работает by design
(другой домен + трекер выключен).

---

## 8. Что осознанно НЕ делаем

- График погашения на бэкенде — считает фронт.
- Уведомления/напоминания о платеже — отдельная задача.
- Редактирование события (только создать/удалить) — история должна быть журналом.
- Шаринг ипотеки между пользователями, роли.
- Refresh-токены (30 дней и повторный вход через виджет достаточно).
