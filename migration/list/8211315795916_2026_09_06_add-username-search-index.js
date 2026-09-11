import { sql } from "bun";

const up = async () => {
  await sql`
    CREATE INDEX CONCURRENTLY users_username_lower_idx ON users (lower(username) text_pattern_ops)
  `;

  await sql`
    CREATE INDEX CONCURRENTLY deleted_users_username_lower_idx ON deleted_users (lower(username) text_pattern_ops)
  `;
};

const down = async () => {
  await sql`DROP INDEX IF EXISTS deleted_users_username_lower_idx`;
  await sql`DROP INDEX IF EXISTS users_username_lower_idx`;
};

export { up, down };
