import { sql } from "bun";

const up = async () => {
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_username_live_ci_unique
    ON users (lower(username))
    WHERE NOT deleted`;
};

const down = async () => {
  await sql`DROP INDEX IF EXISTS users_username_live_ci_unique`;
};

export { up, down };
