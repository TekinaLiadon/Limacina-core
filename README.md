# Limacina-core

Серверная часть лаунчера Minecraft: авторизация (JWT), протокол Yggdrasil (authlib-injector), скины/модели, файлы лаунчера, админ-панель.

API-документация: Scalar UI — `/docs`, OpenAPI-спецификация — `/openapi.json`. Все актуальные эндпоинты — под префиксом `/v1`.

## Установка Bun

```bash
curl -fsSL https://bun.sh/install | bash
```

После установки переоткройте терминал (или выполните `source ~/.bashrc` / `source ~/.zshrc`) и проверьте:

```bash
bun --version
```

## Требования

| Компонент                        | Минимальная версия | Примечание                                            |
| -------------------------------- | ------------------ | ----------------------------------------------------- |
| [Bun](https://bun.sh)            | ≥ 1.2              | Установка — см. выше                                  |
| [PM2](https://pm2.keymetrics.io) | ≥ 7                | Для продакшена: запуск бинарника и перезапуск сервера |
| PostgreSQL                       | ≥ 15               | Если `DB_DRIVER=postgres`                             |

## Развёртывание — все команды по порядку

### 1. Клонирование и зависимости

```bash
git clone <url> && cd Limacina-core
bun install
```

### 2. Переменные окружения

```bash
cp .env.example .env   # затем отредактировать .env
```

Полный список переменных с описаниями и значениями по умолчанию — в комментариях `.env.example`. Минимум для запуска: `NODE_ENV`, `JWT_ACCESS`, `JWT_REFRESH`.

### 3. Структура public/ и ключи

```bash
bun run setup:public        # создать public/launcher, public/textures, public/linux, public/windows и version.json
bun run generate:keypair    # сгенерировать RSA-ключи в keys/ (подпись текстур Yggdrasil)
```

> Ключи создаются один раз. Повторный запуск завершится ошибкой, пока старые ключи не удалены.

### 4. Файлы лаунчера (опционально)

```bash
bun run download:authlib <mc_version>   # скачать authlib-injector в public/launcher/
```

Моды и платформенные zip (`public/linux/x86_64`, `public/windows/x86_64` и т.д.) кладутся вручную или загружаются через панель (`PATCH /v1/panel/launcher`).

### 5. Миграции (только для `DB_DRIVER=postgres`)

```bash
bun run migrate:install   # создать таблицу migrations
bun run migrate:up        # применить все миграции
```

Для `DB_DRIVER=map` (по умолчанию, хранение в памяти) миграции не нужны.

### 6. Конфиг лаунчера (опционально)

```bash
cp config.example.toml config.toml   # затем отредактировать
```

Альтернатива — создать конфиг через API после запуска: `PATCH /v1/panel/launcher/config` (только admin).

### 7. Сборка и запуск через PM2 (продакшен)

PM2 запускает бинарник и следит за ним: перезапускает при падении и поднимает вместе с сервером после перезагрузки.

```bash
npm install -g pm2     # один раз
bun run build          # → dist/Limacina — самодостаточный бинарник
bun run pm2:start      # pm2 start ecosystem.config.js — запуск под PM2
```

Бинарник запускается из корня проекта: `.env`, `public/`, `logs/`, `config.toml` читаются относительно рабочей директории. Переменные из `.env` подхватываются автоматически, но не переопределяют уже выставленные переменные окружения.

Для ручной проверки без PM2:

```bash
./dist/Limacina
```

### 8. Автозапуск после перезагрузки сервера

```bash
pm2 startup            # выведет команду для копирования — выполнить её
pm2 save               # сохранить текущий список процессов
```

После этого Limacina будет автоматически стартовать при каждой перезагрузке сервера.

### 9. Первый запуск — создание владельца

После старта сервера создайте владельца (публичный бутстрап-эндпоинт, доступен только пока owner не создан):

```bash
curl -X POST http://localhost:3005/v1/panel/users/init-owner \
  -H "Content-Type: application/json" \
  -d '{"username": "owner", "password": "securepassword"}'
```

Этот аккаунт используется для входа в админ-панель. Владелец создаётся один раз.

## Управление через PM2

```bash
bun run pm2:status
bun run pm2:logs
bun run pm2:restart    # в т.ч. после пересборки бинарника
bun run pm2:stop
```

Обновление версии сервера:

```bash
git pull
bun install            # при изменении зависимостей
bun run build
bun run pm2:restart
```

## Разработка

Запуск из исходников с hot-reload:

```bash
bun run start:dev
```

Проверка перед коммитом (порядок как в CI):

```bash
bun run check-all       # types → format → test → lint
bun run check-types     # типы (tsgo)
bun run lint            # oxlint
bun run fmt             # oxfmt
bun test                # тесты
```

## Админ-панель (опционально)

Панель — отдельный фронтенд (Nuxt SPA), его сборка не входит в этот репозиторий. Сервер раздаёт её как статику из `public/panel/` (папка в `.gitignore`, деплоится отдельно) по адресу `/panel`.

Чтобы подключить панель:

1. Собрать фронтенд-проект панели.
2. Остановить сервер (`bun run pm2:stop` или убить процесс).
3. Скопировать содержимое сборки (dist) в `public/panel/`.
4. Запустить сервер снова — маршрут `/panel` регистрируется при старте, если папка существует.

Панель общается с API этого же сервера (`/v1/common/auth/*`, `/v1/panel/*`), дополнительный CORS не нужен. Если панель хостится на отдельном домене — укажите его в `CORS_ORIGINS`.

Без `public/panel/` сервер работает в обычном режиме — просто адрес `/panel` не отдаёт SPA, а API доступен напрямую (например, через `/docs`).
