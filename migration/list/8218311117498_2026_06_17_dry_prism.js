import { sql } from "bun";

const up = async () => {
  await sql`CREATE TABLE refresh_tokens (
    jti VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
    username VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  await sql`CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id)`;
};

const down = async () => {
  await sql`DROP INDEX IF EXISTS idx_refresh_tokens_user_id`;
  await sql`DROP TABLE IF EXISTS refresh_tokens`;
};

export { up, down };
