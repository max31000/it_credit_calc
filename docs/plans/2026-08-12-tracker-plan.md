# План реализации: трекер ипотеки + опциональный слёт

Дата: 2026-08-12. Спека: `docs/specs/2026-08-12-tracker-design.md` — **API-контракт из §3
спеки является единственным источником правды для A и B**. Любое расхождение с ним = баг.

Три исполнителя работают **параллельно**. Зоны не пересекаются ни одним файлом.

| Кто | Владеет файлами | Не трогает |
|-----|-----------------|-----------|
| **A** backend | `server/**` | `src/`, `package.json`, `vite.config.ts`, `nginx.conf`, `Dockerfile`, `.github/`, `deploy/` |
| **B** frontend | `src/**`, `package.json`, `package-lock.json`, `vite.config.ts`, `.env.development`, `index.html` | `server/`, `nginx.conf`, `Dockerfile`, `.github/`, `deploy/` |
| **C** infra | `nginx.conf`, `Dockerfile` (фронтовый, корневой), `deploy/**`, `.github/workflows/**`, `README.md`, `.gitignore` | `src/`, `server/` (только чтение) |

Общие правила: комментарии и UI-тексты на русском; ничего не коммитить в `master` без
прохождения своих проверок; никаких секретов в репозитории.

Синхронизация: A и B стартуют одновременно (контракт зафиксирован), C стартует одновременно
с ними. Деплой запускается только после мержа всех трёх.

---

# Executor A — бэкенд

## Файлы (создать)

```
server/CreditCalc.sln
server/Dockerfile
server/.dockerignore
server/src/CreditCalc.Api/CreditCalc.Api.csproj
server/src/CreditCalc.Api/Program.cs
server/src/CreditCalc.Api/appsettings.json
server/src/CreditCalc.Api/appsettings.Production.json
server/src/CreditCalc.Api/Auth/TelegramAuthData.cs
server/src/CreditCalc.Api/Auth/TelegramAuthService.cs
server/src/CreditCalc.Api/Auth/JwtIssuer.cs
server/src/CreditCalc.Api/Contracts/Dtos.cs
server/src/CreditCalc.Api/Contracts/Requests.cs
server/src/CreditCalc.Api/Data/Db.cs
server/src/CreditCalc.Api/Data/MigrationRunner.cs
server/src/CreditCalc.Api/Data/UserRepository.cs
server/src/CreditCalc.Api/Data/MortgageRepository.cs
server/src/CreditCalc.Api/Data/MortgageEventRepository.cs
server/src/CreditCalc.Api/Data/Migrations/001_init.sql
server/src/CreditCalc.Api/Endpoints/AuthEndpoints.cs
server/src/CreditCalc.Api/Endpoints/MortgageEndpoints.cs
server/src/CreditCalc.Api/Middleware/ErrorHandlingMiddleware.cs
server/tests/CreditCalc.Api.Tests/CreditCalc.Api.Tests.csproj
server/tests/CreditCalc.Api.Tests/TelegramAuthServiceTests.cs
server/tests/CreditCalc.Api.Tests/JwtIssuerTests.cs
server/tests/CreditCalc.Api.Tests/MigrationRunnerTests.cs
server/tests/CreditCalc.Api.Tests/ValidationTests.cs
server/tests/CreditCalc.Api.Tests/HealthSmokeTests.cs
```

## Шаги

### A1. Скелет решения
- `dotnet new sln -n CreditCalc` в `server/`, два проекта (`web` и `xunit`), оба `net8.0`,
  `Nullable`/`ImplicitUsings` = enable.
- Пакеты API: `Dapper 2.1.35`, `MySqlConnector 2.3.5`,
  `Microsoft.AspNetCore.Authentication.JwtBearer 8.0.*`, `System.IdentityModel.Tokens.Jwt 7.6.*`,
  `Swashbuckle.AspNetCore 6.8.*`.
- Пакеты тестов: `xunit 2.9`, `xunit.runner.visualstudio`, `Microsoft.NET.Test.Sdk 17.11`,
  `FluentAssertions 6.12`, `Microsoft.AspNetCore.Mvc.Testing 8.0.*`.
- `InternalsVisibleTo` для тестового проекта (нужен для `MigrationRunner.SplitSqlStatements`).
- В `Program.cs` внизу: `public partial class Program { }` — для `WebApplicationFactory`.

### A2. Миграция и MigrationRunner
- `Data/Migrations/001_init.sql` — ровно DDL из §2 спеки. В `.csproj`:
  `<EmbeddedResource Include="Data\Migrations\*.sql" />`.
- `MigrationRunner` — порт из `bonds/src/Bonds.Infrastructure/MigrationRunner.cs`
  (таблица `_migrations`, embedded-ресурсы, `SplitSqlStatements` с вырезанием `--`-комментариев,
  каждая миграция в транзакции). Оставить `SplitSqlStatements` `internal static`.
- В `Program.cs`: прогон миграций на старте, пропуск при
  `app.Environment.IsEnvironment("Testing")`, лог + `throw` при ошибке.

### A3. Auth
- `TelegramAuthService` — порт из `bonds/src/Bonds.Infrastructure/Services/TelegramAuthService.cs`
  без изменений алгоритма (SHA256(bot_token) как secret_key, сортированный `data_check_string`,
  `FixedTimeEquals`, отказ при `auth_date` старше 86400 с).
- `JwtIssuer`: `string Issue(User user)` + `static ulong? GetUserId(ClaimsPrincipal)`.
  Claims `sub` = id пользователя, `telegram_id`. Issuer/Audience/ExpirationDays — из конфига
  с дефолтами `credit_calc`/`credit_calc`/`30`.
- `AuthEndpoints`: `POST /api/auth/telegram` (`AllowAnonymous`) и `GET /api/auth/me`.
  **Без allowlist** — не копировать блок `Telegram:OwnerId` из bonds. Первый вход создаёт
  пользователя, повторный обновляет `username/first_name/last_name/photo_url`.
- В `Program.cs`: `AddJwtBearer` с `TokenValidationParameters` (валидация ключа/issuer/
  audience/lifetime, `ClockSkew` 30 с). `Jwt:Secret` читать **лениво** через
  `IConfigureOptions<JwtBearerOptions>` — паттерн из `bonds/src/Bonds.Api/Program.cs`,
  иначе тесты не смогут подменить секрет.
- `AddAuthorization(o => o.FallbackPolicy = RequireAuthenticatedUser())`.

### A4. Данные и эндпоинты
- `Db.cs`: `MySqlConnection Create()` из `ConnectionStrings:DefaultConnection`, строка читается
  лениво из `IConfiguration` при каждом создании соединения.
- Репозитории — обычные классы, регистрируются `AddScoped`, **все методы первым аргументом
  принимают `ulong userId`**. SQL по §5 спеки: `mortgages` фильтруются `AND user_id = @UserId`,
  `mortgage_events` — `JOIN mortgages m ON m.id = e.mortgage_id AND m.user_id = @UserId`.
  Проверок владения в коде эндпоинтов быть не должно.
- `Contracts/Requests.cs`: `MortgageRequest.Validate() → string?` и
  `MortgageEventRequest.Validate(DateOnly mortgageStartedOn) → string?`, возвращают текст
  ошибки или null. Правила — из §3 спеки дословно.
- `MortgageEndpoints`: девять маршрутов из §3.2. `null` из репозитория → `Results.NotFound`
  с `{ error = "Ипотека не найдена" }`. `POST` возвращает `Results.Created($"/api/mortgages/{id}", dto)`.
- `ErrorHandlingMiddleware` — необработанное исключение → `500 { "error": "Внутренняя ошибка" }`
  + лог; регистрируется **первым** в конвейере.
- JSON: camelCase + `JsonStringEnumConverter`. `DateOnly` сериализуется как `YYYY-MM-DD`
  (System.Text.Json в .NET 8 делает это из коробки); для Dapper зарегистрировать
  `SqlMapper.AddTypeHandler` для `DateOnly` (порт `DapperTypeHandlers` из bonds).

### A5. Конфиг и Dockerfile
- `appsettings.json` — dev-дефолты: `Server=localhost;Port=3306;Database=credit_calc;...`,
  `Jwt:Secret` = заведомо dev-строка ≥ 32 символов, `Telegram:BotToken` = `REPLACE_ME`.
- `appsettings.Production.json` — **без секретов**, только `Jwt:Issuer/Audience/ExpirationDays`,
  `Telegram:BotUsername = mv_cashpulse_bot`, уровни логирования.
- `server/Dockerfile` — **context = `./server`** (важно: C собирает образ именно так):
  ```dockerfile
  FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS base
  WORKDIR /app
  EXPOSE 8080
  ENV ASPNETCORE_URLS=http://+:8080
  FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
  WORKDIR /src
  COPY src/CreditCalc.Api/CreditCalc.Api.csproj src/CreditCalc.Api/
  RUN dotnet restore src/CreditCalc.Api/CreditCalc.Api.csproj
  COPY . .
  RUN dotnet publish src/CreditCalc.Api/CreditCalc.Api.csproj -c Release -o /app/publish
  FROM base AS final
  WORKDIR /app
  COPY --from=build /app/publish .
  ENTRYPOINT ["dotnet", "CreditCalc.Api.dll"]
  ```
- `server/.dockerignore`: `**/bin`, `**/obj`, `tests/`.
- В `server/.gitignore` (или в корневой — **нет, корневой владеет C**) добавить `bin/`, `obj/`
  через собственный `server/.gitignore`.

### A6. Тесты
- `TelegramAuthServiceTests`: валидная подпись (посчитать hash тем же алгоритмом в тесте) →
  true; испорченный hash → false; `auth_date` двухдневной давности → false; пустые
  необязательные поля не попадают в `data_check_string`.
- `JwtIssuerTests`: выпущенный токен читается, `GetUserId` возвращает исходный id.
- `MigrationRunnerTests`: `SplitSqlStatements` не ломается на `;` внутри `--`-комментария,
  не отдаёт пустых statements.
- `ValidationTests`: по одному кейсу на каждое правило §3 (взнос ≥ цены → ошибка, ставка 0 →
  ошибка, `kind: "rate"` с `amount` → ошибка, `kind: "balance"` без `amount` → ошибка,
  `occurredOn` раньше `startedOn` → ошибка, валидные запросы → null).
- `HealthSmokeTests`: `WebApplicationFactory<Program>` с
  `ASPNETCORE_ENVIRONMENT=Testing` → `GET /health` = 200, `GET /api/mortgages` без токена = 401.
- Testcontainers **не подключать** — тесты должны идти без Docker.

## Критерии готовности A

- [ ] `dotnet build server/CreditCalc.sln -c Release` — без ошибок и предупреждений компилятора.
- [ ] `dotnet test server/CreditCalc.sln -c Release` — зелёный, без запущенного Docker.
- [ ] Все девять маршрутов §3.2 + два публичных существуют и совпадают с контрактом
      по путям, телам и кодам ответов.
- [ ] Ни один SQL-запрос к `mortgages`/`mortgage_events` не выполняется без `user_id` в условии.
- [ ] Ни одного секрета в `server/**`.
- [ ] Ручная проверка (опционально, если есть Docker):
      `docker run -d --name cc_mysql -e MYSQL_ROOT_PASSWORD=dev -e MYSQL_DATABASE=credit_calc -p 3307:3306 mysql:8.0`,
      затем `dotnet run --project server/src/CreditCalc.Api` и `curl localhost:8080/health`.

## Команды проверки A

```bash
dotnet restore server/CreditCalc.sln
dotnet build   server/CreditCalc.sln -c Release --no-restore
dotnet test    server/CreditCalc.sln -c Release --no-build
```

---

# Executor B — фронтенд

## Файлы

**Изменить:** `src/App.tsx`, `src/main.tsx`, `src/store/useCalculatorStore.ts`,
`src/components/sections/SlipSection.tsx`, `src/components/sections/ChartsSection.tsx`,
`src/components/sections/InsightsSection.tsx`, `src/components/layout/Header.tsx`,
`package.json`, `vite.config.ts`.

**Создать:** `.env.development`, `src/vite-env.d.ts`,
`src/pages/{CalculatorPage,LoginPage,TrackerListPage,MortgagePage}.tsx`,
`src/api/{client,auth,mortgages,types}.ts`, `src/store/useAuthStore.ts`,
`src/lib/tracker.ts`, `src/lib/__tests__/tracker.test.ts`,
`src/components/tracker/{MortgageForm,MortgageCard,MortgageStatus,EventForm,EventList}.tsx`,
`src/components/ProtectedRoute.tsx`.

## Шаги

### B1. Workstream 0 — тумблер слёта (делать первым, не зависит ни от чего)
1. `useCalculatorStore.ts`: добавить `slipEnabled: boolean` (вне `params`, default `false`),
   `setSlipEnabled`, `effectiveSlipMonth()`. Вынести общий
   `const recalc = (params, slipEnabled) => calculate({ ...params, slipMonth: slipEnabled ? params.slipMonth : 0 })`
   и использовать его в инициализации, `setParam`, `setSlipEnabled`, `onRehydrateStorage`.
   `defaultParams.slipMonth` оставить `36` (запомненная позиция слайдера).
2. Persist: `version: 2`, `partialize: (s) => ({ params: s.params, slipEnabled: s.slipEnabled })`,
   `migrate: (persisted, version) => version < 2 ? { ...persisted, slipEnabled: false } : persisted`.
3. `SlipSection.tsx`: `<Switch>` рядом с заголовком; слайдеры + строка «Рыночная ставка после
   слёта» внутри `<Collapse in={slipEnabled}>`; при выключенном тумблере описание меняется на
   короткое «Сценарий выключен — расчёт идёт по льготной ставке».
4. Заменить `params.slipMonth` на `effectiveSlipMonth()` в: `ChartsSection.tsx` строки
   59, 73, 118, 130, 239, 241; `InsightsSection.tsx` строка 184. Вкладку «Риск слёта»
   оставить видимой всегда.
5. Тест в `src/lib/__tests__/` или `src/store/__tests__/`: при `slipEnabled=false`
   `result.slip === null` независимо от `params.slipMonth`; после `setSlipEnabled(true)`
   `result.slip !== null`.

### B2. Инфраструктура фронта
- `npm i react-router-dom` (+ `@mantine/notifications`, `@mantine/dates` — если нужны тосты
  и DatePicker для формы; допускается обойтись `TextInput type="date"`, тогда не ставить).
- `vite.config.ts`: добавить
  ```ts
  server: { proxy: { '/credit_calc/api': { target: 'http://localhost:8080',
    changeOrigin: true, rewrite: (p) => p.replace(/^\/credit_calc\/api/, '/api') } } }
  ```
  Ничего другого в этом файле не менять.
- `.env.development`: `VITE_API_BASE=/credit_calc/api`.
- `src/vite-env.d.ts`: типизировать `ImportMetaEnv` (`VITE_API_BASE?: string`).
- `src/api/client.ts`: `API_BASE`, `TRACKER_ENABLED`, `fetch`-обёртка с `Authorization`,
  обработкой `401` (logout + переход на `/login`), парсингом `{ error }`, `204 → undefined`.
  Ориентир — `bonds/bonds-web/src/api/client.ts`.
- `src/api/types.ts`: TS-типы **дословно по §3 спеки** — `MortgageDto`, `MortgageEventDto`,
  `MortgageEventKind = 'balance' | 'rate' | 'prepayment' | 'payment'`, `MortgageDetails`,
  `AuthUser`, `AuthResponse`.
- `src/api/auth.ts`: `loginWithTelegram(data)`, `fetchMe(token)` (маппинг snake_case полей
  виджета в camelCase тела запроса — см. `bonds-web/src/api/auth.ts`).
- `src/api/mortgages.ts`: `listMortgages`, `getMortgage`, `createMortgage`, `updateMortgage`,
  `deleteMortgage`, `listEvents`, `createEvent`, `deleteEvent`.
- `src/store/useAuthStore.ts`: zustand + persist, ключ `credit-calc-auth`,
  `{ token, user, setAuth, logout, isAuthenticated }`.

### B3. Роутинг
- `main.tsx` / `App.tsx`: `<BrowserRouter basename={import.meta.env.BASE_URL}>` внутри
  `MantineProvider`. Текущее содержимое `App` переезжает в `pages/CalculatorPage.tsx`
  **без изменений логики**.
- Маршруты по §6 спеки; `ProtectedRoute` (порт из bonds) для `/tracker/*`;
  при `!TRACKER_ENABLED` маршруты `/tracker*` и `/login` заменяются на `<Navigate to="/" replace>`.
- `Header.tsx`: навигация «Калькулятор | Трекер» и блок авторизации — рендерятся только
  при `TRACKER_ENABLED`. Залогинен → имя + «Выйти»; гость → «Войти».

### B4. Расчёт состояния ипотеки
- `src/lib/tracker.ts` — `computeMortgageState` по алгоритму §6 спеки. Чистая функция,
  `today` — обязательный аргумент (никаких `new Date()` внутри). `calcPMT` импортировать
  из `lib/engine.ts`, не дублировать.
- Тесты `src/lib/__tests__/tracker.test.ts`: ипотека без событий (остаток совпадает с
  аннуитетной формулой на N месяцев); событие `balance` перебивает прокрутку;
  `prepayment` уменьшает остаток и `monthsLeft`; событие `rate` (слёт) увеличивает
  `monthsLeft`; платёж меньше месячных процентов → `monthsLeft === null`;
  событие с датой в будущем не влияет на «сегодня».

### B5. Экраны
- `TrackerListPage`: список карточек (`MortgageCard`: название, банк, остаток, платёж,
  «осталось N мес до MM.YYYY», прогресс-бар), кнопка «Добавить ипотеку», состояния
  loading / ошибка / пусто.
- `MortgagePage`: `MortgageStatus` (остаток, ставка, платёж, осталось платежей/месяцев,
  дата закрытия, погашено тела + прогресс), `EventForm` (вид корректировки → нужные поля),
  `EventList` (хронология с удалением), кнопки «Редактировать» / «Удалить ипотеку»
  (с подтверждением через `Modal`).
- `MortgageForm` (create/edit): поля по `MortgageRequest`; клиентская валидация зеркалит
  §3 спеки, чтобы `400` не был первым фидбеком; ошибка сервера показывается как есть.
- `CalculatorPage`: кнопка «Завести ипотеку из текущего расчёта» → `/tracker/new` с
  префиллом из `useCalculatorStore` (маппинг — §6 спеки). Видна только при
  `TRACKER_ENABLED && isAuthenticated`.
- `LoginPage`: Telegram Login Widget, `data-telegram-login="mv_cashpulse_bot"` — порт из
  `bonds-web/src/pages/Login.tsx`. Подпись «Вход нужен только для трекера, калькулятор
  работает без него».

## Критерии готовности B

- [ ] Тумблер слёта выключен на чистом localStorage; выводы/графики не показывают слёт;
      включение возвращает прежнее поведение; у пользователя со старым состоянием (v1)
      слёт тоже выключен, а значение месяца сохранено.
- [ ] `npm run build` с **неустановленным** `VITE_API_BASE` даёт сборку без пунктов
      «Трекер»/«Войти», `/tracker` редиректит на `/` (Pages-режим).
- [ ] Все вызовы API совпадают с §3 спеки по путям, телам и обработке кодов.
- [ ] `computeMortgageState` покрыта тестами из B4, все зелёные.
- [ ] Никаких правок в `server/`, `nginx.conf`, `Dockerfile`, `.github/`, `deploy/`.

## Команды проверки B

```bash
npm ci
npm run test -- --run
npm run typecheck
npm run lint
npm run build                      # VDS-режим (VITE_API_BASE из .env.development не попадает в prod-сборку)
VITE_API_BASE=/credit_calc/api npm run build   # проверка режима «трекер включён»
```

---

# Executor C — инфраструктура

## Файлы

**Изменить:** `nginx.conf`, `Dockerfile` (корневой, фронтовый), `.github/workflows/deploy.yml`,
`README.md`.
**Создать:** `deploy/docker-compose.prod.yml`, `deploy/.env.example`.

## Шаги

### C1. nginx
Добавить блок `location /credit_calc/api/` из §7.1 спеки **выше** `location /credit_calc/`.
Проверить синтаксис: `docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t`.

### C2. Фронтовый Dockerfile
Перед `RUN npm run build` добавить:
```dockerfile
ARG VITE_API_BASE=""
ENV VITE_API_BASE=$VITE_API_BASE
```
Дефолт пустой — сборка без аргумента даёт фронт без трекера (безопасно по умолчанию).

### C3. docker-compose
`deploy/docker-compose.prod.yml` по таблице §7.2 спеки:
- `credit_calc` — образ `ghcr.io/max31000/it_credit_calc:latest`, `127.0.0.1:8081:80`,
  `depends_on: [credit_calc_api]`;
- `credit_calc_api` — `ghcr.io/max31000/it_credit_calc-api:latest`, портов наружу нет,
  ENV: `ASPNETCORE_ENVIRONMENT=Production`, `ASPNETCORE_URLS=http://+:8080`,
  `ConnectionStrings__DefaultConnection=Server=credit_calc_mysql;Port=3306;Database=credit_calc;User=credit_calc;Password=${MYSQL_PASSWORD};AllowPublicKeyRetrieval=true;`,
  `Jwt__Secret=${JWT_SECRET}`, `Telegram__BotToken=${TELEGRAM_BOT_TOKEN}`,
  `Telegram__BotUsername=mv_cashpulse_bot`;
  `depends_on: credit_calc_mysql: { condition: service_healthy }`;
- `credit_calc_mysql` — `mysql:8.0`, ENV `MYSQL_ROOT_PASSWORD`/`MYSQL_DATABASE=credit_calc`/
  `MYSQL_USER=credit_calc`/`MYSQL_PASSWORD`, volume `credit_calc_mysql_data:/var/lib/mysql`,
  healthcheck `mysqladmin ping -h localhost` (interval 10s, retries 10);
- сеть `credit_calc_net`, у всех трёх, `restart: unless-stopped`, `container_name` как в таблице.
`deploy/.env.example` — те же ключи с плейсхолдерами, без значений.

### C4. Workflow
Переписать `.github/workflows/deploy.yml` по графу §7.3:
- `test-web` — существующие шаги + `npm run lint`.
- `test-api` — `actions/setup-dotnet@v4` c `dotnet-version: '8.0.x'`, кэш NuGet,
  `dotnet restore/build/test server/CreditCalc.sln -c Release`.
- `build-web` (`needs: [test-web, test-api]`) — как сейчас, плюс
  `build-args: VITE_API_BASE=/credit_calc/api`.
- `build-api` (`needs: [test-web, test-api]`) — `context: ./server`, `file: server/Dockerfile`,
  теги `ghcr.io/max31000/it_credit_calc-api:latest` и `:sha-${{ github.sha }}`.
- `deploy` (`needs: [build-web, build-api]`):
  1. `appleboy/scp-action@v0.1.7`: `deploy/docker-compose.prod.yml` → `/opt/credit_calc/`;
  2. `appleboy/ssh-action@v1` с `envs: GHCR_PAT,JWT_SECRET,MYSQL_ROOT_PASSWORD,MYSQL_PASSWORD,TELEGRAM_BOT_TOKEN`:
     ```bash
     set -e
     cd /opt/credit_calc
     umask 077
     cat > .env <<EOF
     JWT_SECRET=${JWT_SECRET}
     MYSQL_ROOT_PASSWORD=${MYSQL_ROOT_PASSWORD}
     MYSQL_PASSWORD=${MYSQL_PASSWORD}
     TELEGRAM_BOT_TOKEN=${TELEGRAM_BOT_TOKEN}
     EOF
     chmod 600 .env
     echo "${GHCR_PAT}" | docker login ghcr.io -u ${{ github.actor }} --password-stdin
     docker rm -f credit_calc 2>/dev/null || true   # снос старого `docker run`-контейнера, идемпотентно
     docker compose -f docker-compose.prod.yml pull
     docker compose -f docker-compose.prod.yml up -d --remove-orphans
     sleep 10
     curl -sf http://localhost:8081/credit_calc/ >/dev/null || (echo "frontend health failed" && exit 1)
     curl -sf http://localhost:8081/credit_calc/api/health | grep -q '"ok"' || (echo "api health failed" && exit 1)
     docker image prune -f
     ```
  3. Telegram-уведомление при `failure()` — сохранить как сейчас.
- `pages` (`needs: test-web`) — восстановить удалённый job (рецепт из коммита 3900087^,
  файл `deploy-ghp.yml`), внутри существующего `deploy.yml`:
  `permissions: contents: write`; сборка с `VITE_BASE_PATH=/it_credit_calc/` и
  `VITE_API_BASE=''`; публикация `peaceiris/actions-gh-pages@v4` (`publish_dir: ./dist`,
  `enable_jekyll: false`).
  Контекст: Pages-деплой был удалён в апреле, ветка `gh-pages` с тех пор заморожена,
  а README утверждает обратное — этот job приводит реальность к README.
- `concurrency: deploy-credit-calc`, `cancel-in-progress: true` — сохранить.

### C5. README
- Раздел «Деплой»: два образа, docker-compose на VDS, схема
  `VDS nginx → 127.0.0.1:8081 → nginx контейнера → /credit_calc/api/ → credit_calc_api:8080`.
- Раздел «Трекер»: что это, что требует логина через Telegram и доступен только на
  `mvv42.ru/credit_calc/` (на Pages выключен).
- Таблица «Где открыть»: добавить строку про `mvv42.ru/credit_calc/`.
- Структура проекта: добавить `server/` и `deploy/`.
- Локальный запуск бэкенда: `docker compose` не нужен — достаточно
  MySQL-контейнера + `dotnet run --project server/src/CreditCalc.Api`.
- `.gitignore`: добавить `bin/`, `obj/`, `*.user`.

## Критерии готовности C

- [ ] `nginx -t` на изменённом конфиге проходит.
- [ ] `docker compose -f deploy/docker-compose.prod.yml config` валиден
      (с временным `.env` из `.env.example`).
- [ ] Workflow проходит `actionlint` (или хотя бы `yq`-парсинг) и не содержит секретов
      в открытом виде — все через `secrets.*` и механизм `envs`.
- [ ] `docker compose`-файл не публикует наружу ни порт MySQL, ни порт API.
- [ ] Ни одной правки в `src/` и `server/`.

## Команды проверки C

```bash
docker run --rm -v "$PWD/nginx.conf:/etc/nginx/conf.d/default.conf:ro" nginx:alpine nginx -t
cp deploy/.env.example deploy/.env && docker compose -f deploy/docker-compose.prod.yml config >/dev/null && rm deploy/.env
actionlint .github/workflows/deploy.yml   # если установлен
```

---

# Финальная сборка (оркестратор, после мержа A+B+C)

1. Создать секреты:
   ```bash
   gh secret set JWT_SECRET            --body "$(openssl rand -base64 48)"
   gh secret set MYSQL_ROOT_PASSWORD   --body "$(openssl rand -base64 24 | tr -d '/+=')"
   gh secret set MYSQL_PASSWORD        --body "$(openssl rand -base64 24 | tr -d '/+=')"
   ```
2. Локальный прогон всего: `npm ci && npm run test -- --run && npm run typecheck && npm run lint && npm run build`
   и `dotnet test server/CreditCalc.sln -c Release`.
3. Push в `master` → автодеплой.
4. Постдеплойная проверка на VDS:
   - `https://mvv42.ru/credit_calc/` открывается, тумблер слёта выключен;
   - `https://mvv42.ru/credit_calc/api/health` → `{"status":"ok"}`;
   - `https://mvv42.ru/credit_calc/api/mortgages` без токена → `401`;
   - вход через Telegram, создание ипотеки, добавление корректировки, перезагрузка страницы;
   - `docker compose -f /opt/credit_calc/docker-compose.prod.yml ps` — три сервиса `Up`,
     mysql `healthy`;
   - повторный деплой не теряет данные (проверить, что ипотека на месте).

# Риски

| Риск | Митигация |
|------|-----------|
| nginx падает на старте, если `credit_calc_api` ещё не поднят | `resolver 127.0.0.11` + `set $api` — имя резолвится в рантайме (§7.1) |
| Старый контейнер `credit_calc` от `docker run` конфликтует с compose по имени | `docker rm -f credit_calc \|\| true` перед `up` |
| `VITE_API_BASE` не проброшен в образ → трекер молча пропал в проде | health-чек `/credit_calc/api/health` + ручная проверка пункта меню после деплоя |
| Расхождение DTO между A и B | §3 спеки — единственный источник; при необходимости менять контракт правится спека и уведомляются оба |
| Потеря данных при передеплое | именованный volume `credit_calc_mysql_data`, `down` без `-v` в скрипте не вызывается вовсе |
