# Limacina-core

Серверная часть лаунчера Minecraft: JWT-авторизация, протокол Yggdrasil (authlib-injector), скины, плащи и модели, файлы и релизы лаунчера, админ-панель, RCON и статус игрового сервера.

API-документация: Scalar UI на `/docs`, OpenAPI-спецификация на `/openapi.json`. Эндпоинты живут под префиксом `/v1`. Исключение одно: протокол Yggdrasil, его пути диктует authlib-injector, поэтому `/authserver/*`, `/sessionserver/*`, `/api/*` и метаданные на `GET /` находятся в корне сервера.

## Требования

| Компонент                        | Версия  | Примечание                                                                   |
| -------------------------------- | ------- | ---------------------------------------------------------------------------- |
| [Bun](https://bun.sh)            | ≥ 1.4.2 | Рантайм, сборка и CLI миграций. `Bun.cron` требует 1.4, пакет миграций 1.4.2 |
| [PM2](https://pm2.keymetrics.io) | ≥ 7     | Прод: запуск бинарника, рестарт, автозапуск                                  |
| PostgreSQL                       | ≥ 14    | Прод-хранилище, для которого в репозитории есть миграции                     |
| Redis                            | —       | Опционально: кеш и бакеты rate limit. Без него всё живёт в памяти процесса   |

MariaDB в коде поддержана на уровне SQL-сторов и интеграционных тестов (`DB_DRIVER=mariadb`), но миграции в репозитории написаны под PostgreSQL. Поднять новую MariaDB-базу командами из этого README нельзя. Для нового окружения используйте PostgreSQL.

## Установка Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

После установки переоткройте терминал или выполните `source ~/.bashrc` (`~/.zshrc` для zsh) и проверьте версию:

```bash
bun --version
```

## Быстрый старт для разработки

```bash
git clone <url> Limacina-core
cd Limacina-core
bun install --frozen-lockfile
cp .env.example .env
```

В `.env` для разработки достаточно:

```dotenv
NODE_ENV=development
DB_DRIVER=map
JWT_ACCESS=<случайная строка минимум 32 символа>
JWT_REFRESH=<случайная строка минимум 32 символа>
```

Секреты удобно сгенерировать командой `openssl rand -hex 32`. Плейсхолдеры из `.env.example` намеренно короче 32 символов: если их не заменить, старт упадёт на валидации конфига.

`DB_DRIVER=map` хранит данные в памяти процесса: после рестарта пользователи и контент исчезают. Это режим только для разработки, в `NODE_ENV=production` он запрещён.

```bash
bun run setup:public
bun run start:dev
```

Сервер поднимется на `http://localhost:3005`. Первого владельца создайте по инструкции из раздела [Первый владелец](#первый-владелец).

## Развёртывание production с нуля

### 1. Подготовьте PostgreSQL

Создайте пользователя и базу. Пример для локального PostgreSQL:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER limacina WITH PASSWORD 'replace-with-strong-password';
CREATE DATABASE limacina OWNER limacina;
SQL
```

Если база внешняя, заранее убедитесь, что сервер до неё дотягивается, а `DATABASE_URL` содержит правильные хост, порт и имя базы.

### 2. Клонируйте репозиторий и поставьте зависимости

```bash
git clone <url> Limacina-core
cd Limacina-core
bun install --frozen-lockfile
```

Лок-файл `bun.lock` коммитится, поэтому `--frozen-lockfile` должен проходить без изменений. Для обновления зависимостей используйте точечные `bun update <пакет>` или точные пины в `package.json`.

### 3. Заполните `.env`

```bash
cp .env.example .env
```

Минимальный production-конфиг:

```dotenv
NODE_ENV=production
PORT=3005
BASE_URL=https://mc.example.com
JWT_ACCESS=<openssl rand -hex 32>
JWT_REFRESH=<openssl rand -hex 32>
DB_DRIVER=postgres
DATABASE_URL=postgres://limacina:password@127.0.0.1:5432/limacina
```

Что важно не перепутать:

- `JWT_ACCESS` и `JWT_REFRESH` короче 32 символов валят старт.
- `DB_DRIVER=map` в production запрещён, нужен `postgres` и `DATABASE_URL`.
- `BASE_URL` должен быть публичным адресом сервера: он попадает в ссылки на текстуры и метаданные Yggdrasil.
- За reverse-proxy оставьте `BEHIND_PROXY=true` и по возможности задайте `TRUST_PROXY` (например, `127.0.0.1`). Если сервер принимает подключения напрямую, поставьте `BEHIND_PROXY=false`, иначе клиент сможет подделать IP заголовком `X-Forwarded-For`.
- `CORS_ORIGINS` нужен только если панель или лаунчер ходят с другого домена. Без переменной CORS закрыт.
- `DATABASE_URL` держите в `.env` или реальном окружении. `SECRETS` читает только приложение: CLI миграций и шаги rebuild-конвейера его не видят.

Полный список переменных с описаниями: [docs/setup.md](docs/setup.md).

### 4. Создайте каталоги и ключи

```bash
bun run setup:public
bun run generate:keypair
```

`setup:public` создаёт `public/launcher`, `public/launcher/mods`, `public/releases`, `public/textures`, `public/capes`, `public/models`. Моды кладутся в `public/launcher/mods` вручную или через панель, остальное наполняется через API и панель.

Опционально: `bun run download:authlib [authlib_version]` скачивает `authlib-injector.jar` в `public/launcher`. Без аргумента берётся последний релиз.

`generate:keypair` создаёт `keys/private.pem` и `keys/public.pem` для подписи текстур Yggdrasil. Ключи генерируются один раз: повторный запуск завершится ошибкой, пока старые файлы не удалены. Без ключей сервер стартует, но профили Yggdrasil отдаются без подписи и в лог пишется ошибка. Если бинарник запускается не из корня проекта, задайте абсолютный `KEYS_DIR`.

### 5. Примените миграции

```bash
bun run migrate:up
```

Миграции нужны только для SQL-драйверов и в текущем репозитории поддерживают PostgreSQL. `migrate:up` сам создаёт служебную таблицу, отдельный `bun run migrate:install` опционален. Команда читает `DATABASE_URL` из окружения или `.env`.

Новые миграции создаются только через `bun run migrate:create <имя>`, вручную файлы в `migration/list/` не добавляются. Изменение уже применённого файла ловится по checksum и прерывает следующий `up`.

### 6. Конфиг лаунчера (опционально)

```bash
cp config.example.toml config.toml
```

Файл читается из корня проекта и перечитывается при изменении. Тот же конфиг можно записать из панели: `PATCH /v1/panel/launcher/config` (только owner).

### 7. Соберите бинарник

```bash
bun run build
```

Получается самодостаточный `dist/Limacina`. Флаги сборки не упрощайте: `NODE_ENV=production` зашивается в бинарник на этапе компиляции, без него в проде ломается ветка логирования. Бинарник запускается из корня проекта: `.env`, `public/`, `keys/`, `logs/` и `config.toml` читаются относительно рабочей директории.

Для ручной проверки без PM2:

```bash
./dist/Limacina
```

### 8. Запустите под PM2

```bash
npm install -g pm2
bun run pm2:start
pm2 status
```

`ecosystem.config.js` запускает `dist/Limacina` в fork-режиме, с `autorestart`, лимитом памяти 1G и защитой от рестарт-лупа. `NODE_ENV=production` выставляется в конфиге PM2. Переменные окружения из PM2 имеют приоритет над `.env`.

Автозапуск после перезагрузки сервера:

```bash
pm2 startup
# выполните команду, которую выведет pm2
pm2 save
```

## Первый владелец

Пока в базе нет пользователя с ролью owner, сервер при старте создаёт в корне проекта файл `bootstrap.token` с правами `0600` и печатает токен в stdout (он же виден в `pm2 logs`). Токен нужен для одного запроса:

```bash
curl -X POST http://127.0.0.1:3005/v1/panel/users/init-owner \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"owner\",\"password\":\"replace-with-strong-password\",\"token\":\"$(cat bootstrap.token)\"}"
```

Ответ `201` означает, что владелец создан, файл `bootstrap.token` удалён, а токен погашен. Дальше этот аккаунт используется для входа в панель.

Если `bootstrap.token` нет, проверьте, не создан ли владелец раньше: при наличии owner файл удаляется при старте. Повторный `init-owner` отвечает `409` ещё до проверки токена. Запрос без поля `token` не проходит валидацию (`400`), неверный токен даёт `403`.

## Проверка после запуска

```bash
curl -fsS http://127.0.0.1:3005/openapi.json >/dev/null && echo "openapi ok"
curl -fsS http://127.0.0.1:3005/docs >/dev/null && echo "docs ok"
curl -fsS http://127.0.0.1:3005/ | head
```

Последний запрос отдаёт метаданные Yggdrasil, включая публичный ключ подписи текстур. Статус игрового сервера (`GET /v1/common/status`) работает только при заданном `MINECRAFT_HOST`. Панель доступна на `/panel` после деплоя её сборки.

## Обновление сервера

Штатный путь для прода: пересборка из панели. `POST /v1/panel/server/restart` с телом `{"rebuild": true}` (только owner) запускает в фоне `git pull --ff-only` → `bun install --frozen-lockfile` → `bun run build` → `bun run migrate:up` и затем перезапускает процесс. Статус конвейера: `GET /v1/panel/server/rebuild`. Сборка идёт до миграций, при падении миграций бинарник откатывается из `dist/Limacina.previous`, поэтому прод остаётся на согласованной паре «бинарь и схема».

Ручной путь:

```bash
git pull --ff-only
bun install --frozen-lockfile
bun run build
bun run migrate:up
bun run pm2:restart
```

Порядок важен: сначала сборка, потом миграции, потом рестарт. Ручной путь не делает резервную копию бинарника: если миграции упадут, откатывать `dist/Limacina` придётся вручную. Для критичных обновлений используйте пересборку из панели.

`DEPLOY_PINNED_REVISION` (полный 40-символьный git SHA) заставляет rebuild-конвейер прерваться, если после `git pull` ревизия не совпала с закреплённой.

## Управление PM2

```bash
bun run pm2:status
bun run pm2:logs
bun run pm2:restart    # в том числе после пересборки бинарника
bun run pm2:stop
```

Логи пишутся в `logs/YYYY-MM-DD.log` и дублируются в stdout, поэтому `pm2 logs` показывает те же JSON-строки. Ротацию делает внешний logrotate, файл пересоздаётся сам.

## Разработка

```bash
bun run start:dev          # запуск из исходников с hot-reload
bun run test:unit          # быстрый прогон без e2e и БД-интеграции
bun test src/<модуль>/...  # тесты конкретной задачи
bun run check-all          # types → fmt → test → lint → coverage gate → randomize
```

`check-all` гоняется перед релизом и требует дев-базу в `DATABASE_URL`: без неё постгрес-тесты скипаются и гейт покрытия красный. Сквозные пользовательские сценарии: `bun run test:flows` (тоже при поднятой дев-базе). Подробности: [docs/testing.md](docs/testing.md).

## Админ-панель

Панель это отдельный фронтенд-репозиторий. Сервер раздаёт её сборку из `public/panel` по адресу `/panel`; маршрут регистрируется на старте всегда, поэтому деплой панели не требует рестарта сервера.

```bash
bun run panel:deploy          # последняя версия ветки по умолчанию
bun run panel:deploy v1.2.0   # тег или SHA для отката
```

Скрипт клонирует репозиторий панели в `tmp/panel-admin` (переопределяется `PANEL_REPO_DIR`), ставит зависимости, собирает и атомарно подменяет `public/panel`. Если панель хостится на отдельном домене, добавьте его в `CORS_ORIGINS`; на том же origin дополнительный CORS не нужен.

Ручной вариант: собрать панель отдельно и скопировать содержимое сборки в `public/panel`. Без этой папки сервер работает как обычно, `/panel` просто не отдаёт SPA.

## Если старт не удался

| Симптом                                                       | Причина и решение                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Invalid environment variables`, ругань на `JWT_ACCESS`       | Секрет короче 32 символов. Сгенерируйте `openssl rand -hex 32`.                                            |
| `DB_DRIVER=map is not allowed in production`                  | В проде нужен `DB_DRIVER=postgres` и `DATABASE_URL`.                                                       |
| `DATABASE_URL is required when DB_DRIVER=postgres or mariadb` | Переменная не задана или не видна процессу. Проверьте `.env` в рабочей директории.                         |
| `bootstrap.token` нет, `init-owner` отвечает `409`            | Владелец уже создан. Файл удаляется при старте, повторная инициализация запрещена.                         |
| `init-owner` отвечает `400`                                   | В теле нет `token`. Добавьте содержимое `bootstrap.token`.                                                 |
| Миграция MariaDB падает на `TIMESTAMP WITH TIME ZONE`         | Миграции в репозитории postgres-only. Для нового окружения используйте PostgreSQL.                         |
| `bun run migrate:up` не видит `DATABASE_URL`                  | `DATABASE_URL` лежит только в `SECRETS`: CLI миграций его не читает. Перенесите переменную в `.env`.       |
| `/panel` отвечает `404`                                       | Сборка панели не задеплоена. Выполните `bun run panel:deploy`.                                             |
| Сборка падает на `@nestjs/platform-express`                   | Устаревший `package.json` или неполный `bun install`. В текущем репозитории пакет вынесен во `--external`. |

## Документация

- [docs/setup.md](docs/setup.md) — переменные окружения, драйверы, миграции, первый владелец.
- [docs/deployment.md](docs/deployment.md) — эксплуатация: PM2, обновление, панель, релизы.
- [docs/architecture.md](docs/architecture.md) — модули, слои, хранилища, обработка ошибок.
- [docs/api.md](docs/api.md) — доступ, роли, лимиты, формат ошибок.
- [docs/flows.md](docs/flows.md) — пользовательские сценарии.
- [docs/testing.md](docs/testing.md) — режимы тестов, покрытие, дев-база.
