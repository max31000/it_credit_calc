# Ипотечный стратег

Калькулятор льготной ИТ-ипотеки: платёж, точка полного погашения и цена слёта
с льготной программы.

## Где открыть

| Хостинг | URL | Примечание |
|---------|-----|-----------|
| **VDS** | https://mvv42.ru/credit_calc/ | Основной адрес; здесь же доступен трекер ипотеки |

## Что делает приложение

Отвечает на практические вопросы заёмщика по льготной ипотеке:

- какой будет обязательный платёж и переплата;
- что выгоднее при заданных ставках — гасить досрочно или платить минимум и копить;
- **когда накоплений хватит, чтобы закрыть ипотеку целиком** (точка полного погашения);
- сколько принесут инвестиции, если копить и платить минимальный платёж;
- **сколько стоит слёт** с льготной программы и сколько экономит немедленное внесение
  всех накоплений в долг при слёте;
- **точка безопасности** — месяц, начиная с которого даже слёт не поднимет платёж
  выше льготного уровня;
- налоговые вычеты (имущественный и по процентам) с прогрессивной шкалой НДФЛ.

Сценарий слёта встроен в симуляцию: в месяц слёта ставка становится рыночной, накопления
вносятся в досрочное погашение, дальше расчёт идёт по новым условиям. Моделирование слёта —
опциональный тумблер, по умолчанию выключен.

## Трекер ипотеки

Отдельный раздел для тех, кто уже взял ипотеку: список своих ипотек, текущий остаток долга,
ставка и платёж с учётом корректировок (новая выписка от банка, досрочные платежи, смена
ставки при слёте с льготы, изменение платежа), прогноз даты полного погашения.

Требует входа через общий аккаунт mvv42 (вход через Telegram в shell `mvv42.ru`, сервис `mvv42-auth`)
и доступен только на `mvv42.ru/credit_calc/` —
на GitHub Pages трекер выключен (сборка идёт без адреса API).

## Параметры

| Параметр | Описание |
|----------|----------|
| Стоимость квартиры, взнос, сумма кредита | Три связанные шкалы с точным вводом; кредит двигается — меняется взнос |
| Льготная ставка / срок | Условия кредита |
| Бюджет на ипотеку в месяц | Всего на ипотечные цели: платёж + досрочка или инвестиции |
| Доходность вклада | Куда копятся свободные деньги |
| Горизонт сравнения | Период анализа |
| Месяц слёта, ключевая ставка, дисконт | Сценарий потери льготы; рыночная ставка = ключевая − дисконт + 1,5% |
| Зарплата | Опционально, для налоговых вычетов |

## Стек и структура

Фронт: React 19 + TypeScript + Mantine 7 + Recharts + Zustand, Vite, Vitest.
Бэкенд трекера: .NET 8 minimal API + Dapper + MySQL.

```
src/
  lib/
    engine.ts              — финансовый движок (без зависимостей, см. ALGORITHMS.md)
    tracker.ts              — расчёт состояния ипотеки по истории корректировок
    formatters.ts          — форматирование чисел
    __tests__/
  store/                   — Zustand-стор калькулятора, persist в localStorage (вход — общий mvv42-auth, `useMe` кита)
  api/                     — клиент API трекера
  pages/                   — Calculator, TrackerList, Mortgage (UI на `@mvv42/kit`)
  components/
    layout/                — Header, Layout
    controls/              — SliderInput, MetricCard, InfoTooltip
    charts/                — общие утилиты графиков
    sections/              — Params, Slip, Insights, Charts, Methodology
    tracker/                — карточки, формы и статус ипотеки
server/                    — .NET 8 API трекера (авторизация — общий mvv42-auth, `Auth/Mvv42Auth.cs`; MySQL)
deploy/                    — docker-compose и .env-шаблон для VDS
docs/specs/                — дизайн-документы
```

## Команды

```bash
npm install        # установка зависимостей
npm run dev        # dev-сервер (http://localhost:5173/credit_calc/)
npm run test       # тесты (Vitest)
npm run build      # production-сборка
npm run typecheck  # проверка TypeScript
npm run lint       # ESLint
```

Локальный запуск бэкенда трекера (без docker-compose — достаточно контейнера MySQL):

```bash
docker run -d --name cc_mysql -e MYSQL_ROOT_PASSWORD=dev -e MYSQL_DATABASE=credit_calc -p 3307:3306 mysql:8.0
dotnet run --project server/src/CreditCalc.Api
curl localhost:8080/health
```

## Деплой

Один workflow `.github/workflows/deploy.yml`: `changes` (какие части изменились) → `backend` (тесты API,
образ `it_credit_calc-api:sha-<commit>`, деплой, health) → `frontend` (тесты фронта, образ
`it_credit_calc:sha-<commit>`, деплой, health). Изменился только фронт — backend пропускается.
`workflow_dispatch` собирает и деплоит обе части. Образы публикуются в GHCR **только** с тегом `sha-<commit>`
(без `latest`); контейнеры помечены `com.centurylinklabs.watchtower.enable=false` — watchtower их не трогает.

Схема на VDS: внешний nginx VDS → `127.0.0.1:8081` → nginx контейнера `credit_calc` →
`/credit_calc/api/` проксируется на `credit_calc_api:8080` (сеть `credit_calc_net`);
MySQL и API наружу не публикуются. `credit_calc_api` также в сети `cashpulse-network` — оттуда он берёт
JWKS общего auth (`http://mvv42-auth:8080`). Состав — `deploy/docker-compose.prod.yml`.

Файлы в `/opt/credit_calc` на сервере:

| Файл | Кто пишет | Содержимое |
|---|---|---|
| `.env` | backend-job (из GitHub Secrets) | `MYSQL_ROOT_PASSWORD`, `MYSQL_PASSWORD` (шаблон `deploy/.env.example`) |
| `tags.env` | backend-job — `API_TAG`, frontend-job — `WEB_TAG` (каждый только свою строку) | шаблон `deploy/tags.env.example` |

Ручные команды на сервере — всегда с обоими env-файлами:

```bash
cd /opt/credit_calc
alias dc='docker compose --env-file .env --env-file tags.env -f docker-compose.prod.yml'
dc ps
dc logs --tail=100 credit_calc_api
dc up -d --no-deps credit_calc_api      # перезапуск API на текущем API_TAG
# откат API: заменить API_TAG в tags.env на прежний sha-<commit>, затем dc up -d --no-deps credit_calc_api
```

Деплой поднимает API и фронт с `--no-deps`, поэтому MySQL им не пересоздаётся. Метка watchtower на
`credit_calc_mysql` применится при следующем ручном `dc up -d credit_calc_mysql` (контейнер пересоздастся,
данные — в томе `credit_calc_mysql_data`). Перед деплоем API проверяется доступность JWKS из
`cashpulse-network`, health API — прямо в контейнер (`http://credit_calc_api:8080/health` из той же сети).
