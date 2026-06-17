// @ts-expect-error — Bun SQL not in bun-types yet
import { sql } from "bun";
import type { MigrationDriver } from "../core/driver.js";

export function create(databaseUrl: string): MigrationDriver {
  const db = new sql(databaseUrl);

  return {
    async install() {
      await db`CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        migration VARCHAR(255) NOT NULL
      )`;
    },

    async listExecuted() {
      const rows = await db`SELECT * FROM migrations ORDER BY id ASC`;
      return rows.map((r: { migration: string }) => r.migration);
    },

    async record(migration: string) {
      await db`INSERT INTO migrations (migration) VALUES (${migration})`;
    },

    async remove(migration: string) {
      await db`DELETE FROM migrations WHERE migration = ${migration}`;
    },

    async close() {
      db.close({ timeout: 0 });
    },
  };
}
