import { sql } from "bun";

const up = async () => {
  await sql`
    CREATE TABLE deleted_users (
      uuid VARCHAR(32) PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(256) NOT NULL,
      skin_url VARCHAR(512),
      role VARCHAR(32) NOT NULL DEFAULT 'user',
      approved BOOLEAN NOT NULL DEFAULT false,
      banned BOOLEAN NOT NULL DEFAULT false,
      deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
};

const down = async () => {
  await sql`DROP TABLE IF EXISTS deleted_users`;
};

export { up, down };
