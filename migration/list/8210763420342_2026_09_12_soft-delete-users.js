import { sql } from "bun";

const up = async () => {
  await sql`ALTER TABLE users ADD COLUMN deleted BOOLEAN NOT NULL DEFAULT false`;
  await sql`ALTER TABLE users ADD COLUMN deleted_at TIMESTAMPTZ`;
  await sql`DELETE FROM deleted_users`;
  await sql`DROP TABLE deleted_users`;
  await sql`ALTER TABLE users DROP CONSTRAINT users_username_key`;
  await sql`CREATE UNIQUE INDEX users_username_live_unique ON users (username) WHERE NOT deleted`;
};

const down = async () => {
  await sql`DROP INDEX IF EXISTS users_username_live_unique`;
  await sql`ALTER TABLE users ADD CONSTRAINT users_username_key UNIQUE (username)`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS deleted_at`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS deleted`;
  await sql`CREATE TABLE deleted_users (
      uuid VARCHAR(32) PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(256) NOT NULL,
      skin_url VARCHAR(512),
      skin_model VARCHAR(16),
      cape_url VARCHAR(512),
      role VARCHAR(32) NOT NULL DEFAULT 'user',
      approved BOOLEAN NOT NULL DEFAULT false,
      banned BOOLEAN NOT NULL DEFAULT false,
      password_changed_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`;
  await sql`CREATE INDEX deleted_users_deleted_at_idx ON deleted_users (deleted_at)`;
  await sql`CREATE INDEX deleted_users_username_lower_idx ON deleted_users (lower(username) text_pattern_ops)`;
};

export { up, down };
