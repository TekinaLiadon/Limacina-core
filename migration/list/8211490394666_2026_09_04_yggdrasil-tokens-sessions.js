import { sql } from "bun";

const up = async () => {
  await sql`
    CREATE TABLE yggdrasil_tokens (
      access_token TEXT PRIMARY KEY,
      user_id VARCHAR(64) NOT NULL,
      profile_id VARCHAR(64),
      username VARCHAR(64) NOT NULL,
      client_token TEXT NOT NULL,
      issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;

  await sql`
    CREATE INDEX yggdrasil_tokens_user_id_idx ON yggdrasil_tokens (user_id)
  `;

  await sql`
    CREATE TABLE yggdrasil_sessions (
      server_id TEXT PRIMARY KEY,
      profile_id VARCHAR(64) NOT NULL,
      username VARCHAR(64) NOT NULL,
      ip VARCHAR(64) NOT NULL DEFAULT '',
      expires_at TIMESTAMPTZ NOT NULL
    )
  `;
};

const down = async () => {
  await sql`DROP TABLE IF EXISTS yggdrasil_sessions`;
  await sql`DROP INDEX IF EXISTS yggdrasil_tokens_user_id_idx`;
  await sql`DROP TABLE IF EXISTS yggdrasil_tokens`;
};

export { up, down };
