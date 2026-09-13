# SANCTION

Платформа доступа: сайт + биллинг + аккаунты + лоадер, работающие от **одной базы данных**.
Купил подписку — в личном кабинете сразу появились логин и пароль лоадера, ключ и скачивание
сборки. Подписка закончилась — ключ и софт перестают работать на следующем же heartbeat.

```
Node.js 22 + Express + node:sqlite        сайт, API, биллинг, админка
C# / .NET 8 WinForms                      лоадер (loader/), без единого NuGet-пакета
ECDH P-256 → HKDF-SHA256 → AES-256-GCM    канал лоадера + ECDSA-подпись токенов
Lava · ЮKassa · Enot · sandbox            приём российских карт, песочница для локальных тестов
```

---

## Быстрый старт

```bash
npm install
npm run reset        # создать базу, настройки, админов и демо-покупателя
npm start            # http://localhost:3000
```

Пароли созданных аккаунтов пишутся в `data/seed-credentials.txt`:

| Аккаунт | Пароль | Что это |
|---|---|---|
| `tiran` | `Sanction!2026` | владелец, полный доступ к админке |
| `drake` | `Sanction!2026` | владелец, полный доступ к админке |
| `demo` | `Demo!2026` | покупатель с активной подпиской — для проверки лоадера |

Админка: <http://localhost:3000/admin> → вход под `tiran`, затем пароль гейта
`lerety65789)5433` (env `ADMIN_GATE_PASSWORD`).

Проверка всего сразу:

```bash
npm test             # 33 e2e-теста: покупка → выдача ключа → вход лоадера → отзыв → истечение
```

---

## Как устроена покупка

```
/pricing  →  POST /api/billing/quote      цена, промокод, итог
          →  POST /api/billing/checkout   заказ + платёжная ссылка
          →  шлюз                         оплата картой
          →  POST /api/payments/webhook/:method   подпись проверена
          →  orders.markPaid()            заказ оплачен
          →  license.extend()             +30 / +90 / +180 дней
          →  credentials.issue()          логин snc_… + пароль (scrypt + AES-GCM в БД)
          →  /checkout/result/:pid        «доступ выдан» + данные и кнопка скачивания
```

Пользователь видит в `/dashboard` логин лоадера, пароль (по кнопке «показать», с аудитом),
ключ `SNC-XXXX-XXXX-XXXX`, срок действия, HWID и историю заказов. Лоадер читает ту же строку
в той же таблице — никакой второй базы и никакой синхронизации по расписанию.

Продление складывается: `pending` — дни копятся до первого входа, `active` — плюс к остатку,
`expired` — новый срок от текущего момента. Таймер стартует при первом успешном входе лоадера
(`activation = on_first_login`), а не в момент оплаты.

---

## Модель доступа

* **Ключи** `SNC-XXXX-XXXX-XXXX` (алфавит без неоднозначных символов), логин лоадера `snc_…`.
* **Тарифы** — ровно 30 / 90 / 180 дней: `SANCTION-30` 690 ₽, `SANCTION-90` 1 590 ₽,
  `SANCTION-180` 2 690 ₽. Цены и состав прав меняются в админке и `server/config.js`.
* **HWID** — привязка к одному устройству; сбросов 3 / 5 / 8 по тарифам, кулдаун 72 ч.
  История устройств хранится в `license_devices`, чёрный список — в `hwid_blacklist`.
* **Истечение** — ключ и софт останавливаются: сессия лоадера отзывается, следующий запрос
  получает `subscription_expired` (402) и ссылку на продление.
* **Отзыв / бан** — мгновенно убивают активные сессии; лоадер узнаёт об этом на heartbeat.
* **Kill-switch и минимальная сборка** — глобальные рубильники в админке: утёкший бинарник
  снимается с доступа без единого запроса к базе у клиентов.
* **Токен лицензии** — подписан ECDSA, живёт 5 минут, привязан к HWID и сессии; лоадер
  проверяет его офлайн зашитым публичным ключом сервера.

---

## Админка

`/admin/login` требует обычного входа **и** пароль гейта — две независимые проверки.
Дальше всё решает гранулярная система прав (`server/lib/permissions.js`, 25 прав в 8 группах):

```
panel.access          базовое право — без него панель не открывается вообще
users.view/edit/ban/permissions
licenses.view/generate/extend/revoke/credentials
hwid.view/reset/blacklist
orders.view/mark_paid/refund
coupons.manage        plans.manage
loader.view/killswitch/build
content.posts/settings    audit.view    system.stats
```

Права выдаются поштучно чекбоксами или пресетами (`support`, `manager`, `moderator`,
`billing`, `full`). `role = owner` (tiran, drake) имеет всё; остальным доступен ровно тот
набор, который им выдали. Разделы панели, кнопки и API-эндпоинты фильтруются по одному и
тому же списку — `requirePerm()` стоит на каждом маршруте.

Разделы: сводка, пользователи, лицензии (генерация ключей пачками + выгрузка CSV), заказы,
промокоды, лоадер (сессии, kill-switch, версии), HWID, контент, настройки, аудит.
Любое привилегированное действие пишется в `audit_log` с актором, целью и IP.

---

## Платежи

| Метод | Env | Статус |
|---|---|---|
| `sandbox` | — | включён по умолчанию: страница подтверждения с подписанной ссылкой, для локальных тестов |
| `lava` | `LAVA_PROJECT_ID`, `LAVA_SECRET_KEY` | подпись ответа проверяется |
| `yookassa` | `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | HTTP Basic Auth, проверка вебхуков |
| `enot` | `ENOT_PROJECT_ID`, `ENOT_WALLET`, `ENOT_SECRET_KEY1/2` | подпись MD5 по секретам |

```bash
PAYMENT_METHODS=sandbox,lava,yookassa,enot   # что показывать на чекауте
PAYMENT_DEFAULT=sandbox
```

Вебхуки: `POST /api/payments/webhook/:method`. Неподписанный вызов отклоняется, повторный
вебхук по уже оплаченному заказу идемпотентен, сумма сверяется с заказом — иначе заказ
помечается `mismatch` и попадает в админку, а не в выдачу.

---

## Лоадер

Полное описание — в [`loader/README.md`](loader/README.md). Коротко:

```bash
npm run loader:config -- https://api.example.com   # вшить адрес API и публичный ключ сервера
cd loader && ./build.sh                            # win-x64, single file → loader/dist/
```

Кнопка **Inject** разблокируется только когда зелёные все ворота: соединение, ключ сервера,
шифрованный канал, подпись токена, активная подписка, совпадение HWID, версия сборки,
запущенная игра. Проверяются они заново в момент клика, а не по кэшу интерфейса.

Сам модуль, который работает внутри игры, в этот репозиторий не входит: `Core/Payload.cs` —
точка подключения вашей сборки (`Configured = true` + реализация `RunAsync`). Лицензионный
слой, доставка и проверки при этом полностью готовы и покрыты тестами.

Протокол: `POST /api/loader/v1/bootstrap` → `handshake` (ECDH + зашифрованная пара
логин/пароль/HWID) → `rpc` (`heartbeat`, `license`, `download`, `hwid_status`, `logout`).
Конверт `base64url(iv|tag|ct)`, AAD = `1|sid|n`, счётчик `n` строго растёт — повторы
отклоняются. Скачивание сборки идёт по одноразовому подписанному билету с контролем SHA-256.

---

## Структура

```
server/
├── index.js              express, CSP с nonce, монтирование, sweep, graceful shutdown
├── config.js             всё окружение в одном месте
├── db.js                 node:sqlite: схема, prepared statements, миграции (user_version)
├── lib/                  util, passwords, permissions, audit, session, ratelimit,
│                         protocol, license, orders, users, seed, icons
├── payments/             index (абстракция), sandbox, lava, yookassa, enot
├── routes/               pages, auth, account, billing, webhooks, admin, loader
└── views/                EJS: landing, тарифы, auth, dashboard, checkout, админка, статус
public/                   css/app.css (~1300 строк дизайн-системы), js/*, шрифты woff2
loader/                   C# .NET 8 WinForms
scripts/                  seed.js, reset.js
tools/                    embed-loader-config.js
tests/                    e2e.test.js (33 теста) + loader-client.js (эталонный клиент)
docs/                     DEPLOY.md
data/                     рантайм: sanction.db, ключи, server-identity.pem (в git не попадает)
```

---

## API

**Публичное**

| | |
|---|---|
| `GET /api/health`, `GET /api/site` | состояние сервиса, настройки, статус-страница |
| `POST /api/auth/register`, `/login`, `/logout`, `GET /api/auth/me`, `POST /api/auth/password` | аккаунт |
| `GET /api/billing/plans`, `/methods`, `POST /api/billing/quote`, `/checkout` | тарифы и заказ |
| `GET /api/billing/orders/:pid`, `POST /api/billing/orders/:pid/cancel` | заказ |
| `GET /api/me/licenses`, `/licenses/:id`, `POST /licenses/:id/reveal`, `/hwid-reset`, `/download` | доступы пользователя |
| `GET /api/me/orders`, `/notifications`, `/sessions`, `PUT /api/me/profile` | кабинет |
| `POST /api/payments/webhook/:method`, `/sandbox/:pid/confirm` | платежи |
| `POST /api/loader/v1/bootstrap`, `/handshake`, `/rpc`, `GET /v1/pubkey` | лоадер |
| `GET /dl/loader?t=…` | артефакт по подписанному билету |

**Админка** (`/api/admin/*`, каждое действие под `requirePerm`)

`gate`, `gate/exit`, `me`, `summary`, `users[/:id]`, `users/:id/status|password|permissions`,
`permissions/catalog`, `licenses[/:id]`, `licenses/generate`, `licenses/:id/extend|plan|revoke|restore|hwid-reset|credentials[/rotate]`,
`hwid/blacklist[/remove]`, `orders[/:pid]`, `orders/:pid/mark-paid|refund`, `coupons[/:id/toggle]`,
`loader/sessions[/revoke]`, `loader/killswitch`, `loader/build`, `posts[/:id/delete]`, `settings`,
`audit`, `maintenance`, `sweep`.

---

## Переменные окружения

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | где слушать |
| `PUBLIC_URL` | `http://localhost:3000` | абсолютные ссылки, вебхуки, скачивание |
| `NODE_ENV` | `development` | `production` включает строгие проверки |
| `DATA_DIR`, `DB_FILE` | `data`, `data/sanction.db` | где жить базе |
| `SESSION_SECRET`, `LICENSE_SECRET` | генерируются в `data/*.key` | подписи cookies и токенов |
| `ADMIN_GATE_PASSWORD` | `lerety65789)5433` | пароль гейта админки |
| `SEED_ADMIN_PASSWORD` | `Sanction!2026` | пароль tiran/drake при первом сиде |
| `COOKIE_SECURE`, `COOKIE_SAMESITE` | `false`, `lax` | в проде — `true` |
| `PRICE_30/90/180`, `PRICE_*_OLD` | 690 / 1590 / 2690 | цены в рублях |
| `MAX_HWID_RESETS`, `HWID_RESET_COOLDOWN_H` | 3, 72 | базовые лимиты HWID |
| `LOADER_VERSION`, `LOADER_MIN_VERSION` | `1.0.4`, `1.0.0` | политика сборок |
| `LOADER_ARTIFACT`, `LOADER_FILE_NAME`, `LOADER_SHA256` | `loader/dist/Sanction.Loader.exe` | что отдавать на `/dl/loader` |
| `LOADER_KILLSWITCH` | `false` | аварийный рубильник |
| `PAYMENT_METHODS`, `PAYMENT_DEFAULT`, `CURRENCY` | `sandbox,lava,yookassa,enot` | биллинг |
| `LAVA_*`, `YOOKASSA_*`, `ENOT_*` | — | ключи шлюзов |
| `RL_GLOBAL/AUTH/LOADER/ADMIN`, `RL_WINDOW_MS` | 600 / 25 / 120 / 240 | rate limit на окно 60 с |
| `LOGIN_MAX_ATTEMPTS`, `LOADER_MAX_ATTEMPTS` | 8, 10 | блокировка подбора |

Прод-развёртывание, reverse proxy, HTTPS и резервные копии — в [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Безопасность

* Пароли — scrypt с солью; пароли лоадера дополнительно шифруются AES-GCM, чтобы поддержку
  можно было оказывать, не храня их в открытом виде в базе.
* CSRF-токен на всех изменяющих запросах, cookies `HttpOnly` + `SameSite=Lax`.
* CSP c nonce на каждый запрос: `script-src 'self' 'nonce-…'`, никаких inline-скриптов.
* Rate limit по областям (глобальный, auth, loader, admin) + блокировка после серии неудач.
* Секреты лицензий не входят в публичный граф объекта: читаются из БД по требованию.
* Подпись вебхуков, сверка суммы, идемпотентность; билеты на скачивание одноразовые и короткие.
* Аудит всех привилегированных действий; сессии сайта можно убить из кабинета и из админки.

Что платформа **не** делает: не распространяет код, вмешивающийся в чужой процесс, и не
содержит средств обхода анализа. Слой лицензирования, доставки и проверок отделён от модуля
(`loader/Sanction.Loader/Core/Payload.cs`) намеренно — так лицензионная часть остаётся
проверяемой, а содержимое вашей сборки определяется только вашей сборочной линией.

---

## Тесты

```bash
npm test
```

33 сквозных сценария на реальном HTTP-сервере и реальной базе (`data/test`): регистрация и
вход, покупка в песочнице, выдача ключа и пароля, вход лоадера с полным рукопожатием,
heartbeat, продление, истечение, отзыв админом, бан, HWID-привязка и сброс, чёрный список,
гранулярные права, гейт админки, генерация ключей пачкой, промокоды, неподписанные вебхуки,
аудит, настройки, режим техработ, ротация паролей лоадера.

Эталонный клиент протокола — `tests/loader-client.js`: он повторяет C#-лоадер шаг в шаг и
служит живой спецификацией формата.
