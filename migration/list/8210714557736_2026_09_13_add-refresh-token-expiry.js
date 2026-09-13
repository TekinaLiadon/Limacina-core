import { sql } from "bun";

const up = async () => {
  await sql`ALTER TABLE refresh_tokens ADD COLUMN expires_at TIMESTAMP WITH TIME ZONE`;
  await sql`UPDATE refresh_tokens SET expires_at = created_at + INTERVAL '365 days' WHERE expires_at IS NULL`;
  await sql`ALTER TABLE refresh_tokens ALTER COLUMN expires_at SET NOT NULL`;
  await sql`CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at)`;
};

const down = async () => {
  await sql`DROP INDEX IF EXISTS idx_refresh_tokens_expires_at`;
  await sql`ALTER TABLE refresh_tokens DROP COLUMN IF EXISTS expires_at`;
};

export { up, down };
