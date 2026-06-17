# Limacina-core

## Требования

| Компонент                        | Минимальная версия | Примечание                                   |
| -------------------------------- | ------------------ | -------------------------------------------- |
| [Bun](https://bun.sh)            | ≥ 1.2              | Нативный SQL-клиент (`bun:sql`) для Postgres |
| PostgreSQL                       | ≥ 15               | Если `DB_DRIVER=postgres`                    |
| [PM2](https://pm2.keymetrics.io) | ≥ 7                | Для продакшена (`pm2:start`)                 |

## Быстрый старт

```bash
bun install
cp .env.example .env
bun run start:dev
```

Swagger доступен по адресу `/api`.

## Миграции

```bash
bun run migrate:install   # создать таблицу migrations
bun run migrate:up        # применить все миграции
bun run migrate:down      # откатить последнюю миграцию
```
