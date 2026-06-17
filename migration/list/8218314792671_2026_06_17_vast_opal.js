import { sql } from "bun";

const up = async () => {
  await sql`CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    uuid VARCHAR(64) NOT NULL UNIQUE,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
  )`;

  await sql`CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN
      NEW.updated_at = CURRENT_TIMESTAMP;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql`;

  await sql`CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE PROCEDURE update_updated_at_column()`;
};

const down = async () => {
  await sql`DROP TRIGGER IF EXISTS update_users_updated_at ON users`;
  await sql`DROP FUNCTION IF EXISTS update_updated_at_column()`;
  await sql`DROP TABLE IF EXISTS users`;
};

export { up, down };
