import { sql } from "bun";

const up = async () => {
  await sql`
    CREATE TABLE user_skins (
      id SERIAL PRIMARY KEY,
      user_uuid VARCHAR(32) NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE TABLE user_models (
      id SERIAL PRIMARY KEY,
      user_uuid VARCHAR(32) NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;
};

const down = async () => {
  await sql`DROP TABLE IF EXISTS user_models`;
  await sql`DROP TABLE IF EXISTS user_skins`;
};

export { up, down };
