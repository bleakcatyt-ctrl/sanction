# Развёртывание Sanction

Прод-чеклист: Node.js 22.5+, reverse proxy с HTTPS, `NODE_ENV=production`, постоянные
секреты в окружении, резервная копия `data/`. Всё остальное — детали ниже.

---

## 1. Сервер

Минимум: 1 vCPU / 1 ГБ RAM / 10 ГБ диска, Ubuntu 22.04+ или Debian 12+.
База — один файл SQLite, отдельный сервер БД не нужен.

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git nginx certbot python3-certbot-nginx
node -v        # v22.x — node:sqlite доступен начиная с 22.5
```

Код:

```bash
sudo mkdir -p /opt/sanction && sudo chown $USER /opt/sanction
git clone <your-fork> /opt/sanction
cd /opt/sanction && npm ci --omit=dev
```

---

## 2. Окружение

`/opt/sanction/.env` (права `600`, в git не попадает):

```ini
NODE_ENV=production
HOST=127.0.0.1
PORT=3000
PUBLIC_URL=https://sanction.example.com

# Секреты — задайте свои, иначе они сгенерируются в data/ при первом запуске
SESSION_SECRET=<64 hex>
LICENSE_SECRET=<64 hex>

# Админка
ADMIN_GATE_PASSWORD=lerety65789)5433
SEED_ADMIN_PASSWORD=<пароль tiran и drake>

# Cookies — в проде обязательно
COOKIE_SECURE=true
COOKIE_SAMESITE=lax

# Прокси: 1 = один локальный nginx; loopback = любой локальный; 0 = app наружу напрямую
TRUST_PROXY=1

# Тарифы (рубли)
PRICE_30=690
PRICE_90=1590
PRICE_180=2690

# Платежи: sandbox оставьте только на тестовом контуре
PAYMENT_METHODS=lava,yookassa,enot
PAYMENT_DEFAULT=lava
LAVA_PROJECT_ID=…
LAVA_SECRET_KEY=…
YOOKASSA_SHOP_ID=…
YOOKASSA_SECRET_KEY=…
ENOT_PROJECT_ID=…
ENOT_WALLET=…
ENOT_SECRET_KEY1=…
ENOT_SECRET_KEY2=…

# Лоадер
LOADER_VERSION=1.0.4
LOADER_MIN_VERSION=1.0.0
LOADER_FILE_NAME=Sanction.Loader.exe
LOADER_ARTIFACT=/opt/sanction/loader/dist/Sanction.Loader.exe
LOADER_SHA256=<sha256 собранного exe>
LOADER_KILLSWITCH=false
```

Сгенерировать секреты: `openssl rand -hex 32` (дважды).

Список всех переменных — в корне README. Проверить конфигурацию до запуска:
`npm run seed` печатает пути, тарифы, стафф и адрес панели.

---

## 3. systemd

`/etc/systemd/system/sanction.service`:

```ini
[Unit]
Description=Sanction platform
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=sanction
WorkingDirectory=/opt/sanction
EnvironmentFile=/opt/sanction/.env
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=3
KillSignal=SIGTERM
TimeoutStopSec=10

# hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/sanction/data
ProtectKernelTunables=true
ProtectControlGroups=true
RestrictSUIDSGID=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd --system --home /opt/sanction --shell /usr/sbin/nologin sanction
sudo chown -R sanction:sanction /opt/sanction/data
sudo systemctl daemon-reload
sudo systemctl enable --now sanction
sudo systemctl status sanction
curl -s http://127.0.0.1:3000/api/health
```

Приложение корректно закрывает сервер по SIGTERM (`server.close()` → exit), поэтому
перезапуск не рвёт активные запросы.

---

## 4. Nginx + HTTPS

```nginx
server {
    listen 80;
    server_name sanction.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sanction.example.com;

    ssl_certificate     /etc/letsencrypt/live/sanction.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sanction.example.com/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;

    client_max_body_size 1m;

    # артефакт лоадера отдаёт приложение (подписанные одноразовые билеты)
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
        proxy_buffering    off;      # важно для /dl/loader
    }

    location /static/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        expires 7d;
        add_header Cache-Control "public";
    }
}
```

```bash
sudo certbot --nginx -d sanction.example.com
sudo nginx -t && sudo systemctl reload nginx
```

Nginx **перезаписывает** `X-Forwarded-For`, поэтому при `TRUST_PROXY=1` приложение видит
реальный адрес клиента, а подделанный заголовок отбрасывается. Если прокси два слоя
(например, Cloudflare → nginx), поставьте `TRUST_PROXY=2`. Если приложение смотрит в
интернет напрямую — `TRUST_PROXY=0`, иначе rate limit можно обойти подменой заголовка.

---

## 5. Лоадер

Сборка на любой машине с .NET 8 SDK (Linux/macOS подходит — включён
`EnableWindowsTargeting`):

```bash
cd /opt/sanction
npm run loader:config -- https://sanction.example.com   # вшить API + публичный ключ сервера
cd loader && ./build.sh                                 # → loader/dist/Sanction.Loader.exe
sha256sum dist/Sanction.Loader.exe                      # → LOADER_SHA256 в .env
```

Затем `sudo systemctl restart sanction`, чтобы подхватить `LOADER_SHA256`.

Релиз новой версии:

1. поднять `Version` в `Sanction.Loader.csproj` и `LOADER_VERSION` в `.env`;
2. собрать и положить exe в `LOADER_ARTIFACT`;
3. в админке → «Лоадер» указать минимальную версию (`LOADER_MIN_VERSION` или
   `POST /api/admin/loader/build`) — старые сборки начнут получать `build_outdated`
   на bootstrap и сами поведут пользователя за новым файлом.

Аварийно снять всё с доступа: «Лоадер» → kill-switch (или `LOADER_KILLSWITCH=true`).
Активные сессии падают на следующем heartbeat, новые не создаются.

---

## 6. Данные и бэкапы

В `data/`:

| Файл | Что это | Терять нельзя |
|---|---|---|
| `sanction.db` (+`-wal`, `-shm`) | вся платформа | да |
| `server-identity.pem` / `.pub.pem` | ECDSA-ключ, подписывающий токены лицензий | да |
| `session.key`, `license.key` | подписи cookies и токенов | да |
| `seed-credentials.txt` | пароли первого входа | нет (удалить в проде) |

Потеря `server-identity.pem` означает, что выпущенные токены перестанут проверяться, —
лоадеры соберутся заново с новым ключом (`npm run loader:config` + публикация).

Бэкап без остановки сервиса:

```bash
sudo -u sanction sqlite3 /opt/sanction/data/sanction.db ".backup '/var/backups/sanction-$(date +%F).db'"
tar -czf /var/backups/sanction-keys-$(date +%F).tgz -C /opt/sanction/data \
    server-identity.pem server-identity.pub.pem session.key license.key
```

Cron раз в сутки + копия вне сервера. Восстановление: положить файлы обратно в `data/`,
`systemctl restart sanction`. Миграции схемы применяются автоматически при старте
(`PRAGMA user_version`), откатывать код ниже уже применённой миграции не стоит.

---

## 7. Платёжные шлюзы

| Шлюз | URL вебхука | Что проверить |
|---|---|---|
| Lava | `https://sanction.example.com/api/payments/webhook/lava` | в кабинете — «уведомления», секрет `LAVA_SECRET_KEY` |
| ЮKassa | `https://sanction.example.com/api/payments/webhook/yookassa` | включить события `payment.succeeded`, `payment.canceled` |
| Enot | `https://sanction.example.com/api/payments/webhook/enot` | оба секрета, IP-whitelist не требуется — проверяется подпись |

Неподписанный или неправильно подписанный вызов отклоняется (ответ не `ok:true`), сумма
сверяется с заказом: расхождение помечает заказ `mismatch` и требует ручного решения в
админке, а не выдаёт доступ. Повторный вебхук идемпотентен.

`PAYMENT_METHODS` на проде — без `sandbox`. Песочницу оставьте на staging-контуре: её
страница подтверждения (`/checkout/sandbox/:pid`) подписана и работает только при
включённом методе.

---

## 8. Первый вход и проверка

```bash
curl -s https://sanction.example.com/api/health
SMOKE_URL=https://sanction.example.com npm run smoke    # 40 проверок всего пути целиком
```

`npm run smoke` создаёт одного тестового пользователя и два ключа — прогоняйте его на
staging или сразу после деплоя, а не на боевой базе с живыми заказами.

1. `/login` → `tiran` / `SEED_ADMIN_PASSWORD`.
2. `/admin` → пароль гейта `ADMIN_GATE_PASSWORD`.
3. Админка → «Настройки»: название, контакты, объявления, статус сайта.
4. Админка → «Лицензии» → сгенерировать тестовый ключ, проверить вход лоадером.
5. Прогнать покупку тестовой картой шлюза и убедиться, что доступ выдался, а в
   `/dashboard` видны логин, пароль и скачивание.
6. Удалить `data/seed-credentials.txt`, сменить `SEED_ADMIN_PASSWORD` у живых аккаунтов.

Демо-аккаунт `demo` (`Demo!2026`) создаётся при сиде — на проде забаньте или удалите его
в админке.

---

## 9. Обновление

```bash
cd /opt/sanction
git fetch && git checkout <tag>
npm ci --omit=dev
sudo systemctl restart sanction
curl -s http://127.0.0.1:3000/api/health
```

Откат: `git checkout <prev-tag> && sudo systemctl restart sanction`. База при этом остаётся
с более новой схемой — миграции аддитивны, поэтому приложение старше на одну-две версии
продолжает работать; перед крупным откатом восстановите бэкап БД.

---

## 10. Мониторинг

* `GET /api/health` — `{ok, db, status, version}`; алерт, если `db:false` или нет ответа 3 раза подряд.
* `GET /api/site` и страница `/status` — публичное состояние сервиса.
* Админка → «Сводка»: пользователи, активные лицензии, выручка, сессии лоадера.
* Админка → «Аудит»: все привилегированные действия с актором, целью и IP.
* Журнал: `journalctl -u sanction -f`. Задачи раз в минуту (истечение лицензий, чистка
  сессий) пишут `[jobs]` в тот же журнал.
* Лоадер на клиентской машине: `%LOCALAPPDATA%\Sanction\crash.log`.

Простая проверка извне:

```bash
*/5 * * * * curl -fsS https://sanction.example.com/api/health >/dev/null || \
            curl -fsS "https://hc.example.com/ping/<id>/fail"
```

---

## 11. Чеклист безопасности

* [ ] `NODE_ENV=production`, `COOKIE_SECURE=true`, HSTS включается автоматически.
* [ ] `SESSION_SECRET` и `LICENSE_SECRET` заданы явно и уникальны.
* [ ] `ADMIN_GATE_PASSWORD` не дефолтный; у `tiran`/`drake` разные сложные пароли.
* [ ] `sandbox` убран из `PAYMENT_METHODS`, вебхуки зарегистрированы в шлюзах.
* [ ] `TRUST_PROXY` соответствует реальной топологии.
* [ ] `data/` доступна только пользователю сервиса, бэкапы шифруются и хранятся вне сервера.
* [ ] `data/seed-credentials.txt` удалён, демо-аккаунт отключён.
* [ ] `LOADER_MIN_VERSION` поднят до актуальной сборки, `LOADER_SHA256` зафиксирован.
* [ ] Rate limits не ослаблены (`RL_*` по умолчанию рассчитаны на боевой трафик).
* [ ] Nginx не отдаёт `/data`, `/server`, `/tests` — всё, кроме `/static`, уходит в приложение.
* [ ] Есть план на kill-switch: кто и по какому событию его включает.

---

## 12. Если что-то не так

| Симптом | Куда смотреть |
|---|---|
| `502` от nginx | `systemctl status sanction`, `journalctl -u sanction -n 100` |
| `db:false` в health | права на `data/`, место на диске, не открыта ли база другим процессом |
| Лоадер: `build_outdated` | `LOADER_MIN_VERSION` выше версии exe — поднимите сборку или опустите порог |
| Лоадер: `identity_mismatch` | exe собран с другим `server-identity.pem`; пересоберите с `npm run loader:config` |
| Лоадер: `hwid_mismatch` | устройство изменилось; сброс в `/dashboard/license` или в админке |
| Вебхук не проходит | URL, секрет шлюза, `PUBLIC_URL` (на него формируется ссылка заказа) |
| Оплата прошла, доступа нет | «Заказы» в админке: статус `mismatch`/`pending`, затем «Отметить оплаченным» |
| Панель не пускает | сначала обычный вход, затем гейт; права `panel.access` у пользователя |
