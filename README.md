# Limacina-core

## Требования

| Компонент                        | Минимальная версия | Примечание                   |
| -------------------------------- | ------------------ | ---------------------------- |
| [Bun](https://bun.sh)            | ≥ 1.2              | -                            |
| PostgreSQL                       | ≥ 15               | Если `DB_DRIVER=postgres`    |
| [PM2](https://pm2.keymetrics.io) | ≥ 7                | Для продакшена (`pm2:start`) |

## Быстрый старт (разработка)

```bash
bun install
cp .env.example .env   # настроить переменные окружения
bun run setup:public   # создать папки в public/
```

Swagger доступен по адресу `/api`.

## Переменные окружения

| Переменная            | Обязательная | По умолчанию            | Описание                                             |
| --------------------- | ------------ | ----------------------- | ---------------------------------------------------- |
| `NODE_ENV`            | да           | —                       | `development` или `production`                       |
| `PORT`                | нет          | `3005`                  | Порт сервера                                         |
| `LOG_LEVEL`           | нет          | `info`                  | Уровень логирования (pino)                           |
| `BASE_URL`            | нет          | `http://localhost:3005` | Базовый URL для ссылок на файлы                      |
| `JWT_ACCESS`          | да           | —                       | Секрет для JWT access-токенов                        |
| `JWT_REFRESH`         | да           | —                       | Секрет для JWT refresh-токенов                       |
| `DB_DRIVER`           | нет          | `map`                   | Бэкенд хранения: `map`, `postgres`, `sqlite`         |
| `YGGDRASIL_PROXY_URL` | нет          | —                       | URL прокси для Yggdrasil API                         |
| `MASTER_PASSWORD`     | нет          | —                       | Универсальный пароль для входа                       |
| `MAX_SKINS_PER_USER`  | нет          | `1`                     | Максимум скинов на пользователя                      |
| `MAX_MODELS_PER_USER` | нет          | `1`                     | Максимум моделей на пользователя                     |
| `CORS_ORIGINS`        | нет          | —                       | Разрешённые origins через запятую (любые если пусто) |

## Миграции

```bash
bun run migrate:install   # создать таблицу migrations
bun run migrate:up        # применить все миграции
bun run migrate:down      # откатить последнюю миграцию
```

## Настройка папок и ключей

```bash
bun run setup:public        # создать public/launcher, public/textures, public/models и т.д.
bun run generate:keypair    # сгенерировать RSA-ключи для Yggdrasil (public/keys/)
bun run download:authlib    # скачать authlib-injector в public/launcher/
```

## Деплой через PM2

### Установка и первый запуск

```bash
npm install -g pm2
bun install
cp .env.example .env
bun run setup:public
bun run generate:keypair
bun run migrate:install
bun run migrate:up
pm2 start ecosystem.config.js
```

### Автозапуск после перезагрузки

```bash
pm2 startup            # выведет команду для копирования — выполнить её
pm2 save               # сохранить текущий список процессов
```

### Управление

```bash
pm2 status
pm2 logs Limacina
pm2 restart Limacina
pm2 stop Limacina
pm2 delete Limacina
```

> Папка `public/panel/` деплоится отдельно (фронтенд). Если её нет, эндпоинты `/panel/*` вернут ошибку.
