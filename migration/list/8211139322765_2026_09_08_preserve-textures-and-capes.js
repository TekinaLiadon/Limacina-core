import { sql } from "bun";

const up = async () => {
  await sql`
    ALTER TABLE deleted_users ADD COLUMN skin_model VARCHAR(16),
    ADD COLUMN cape_url VARCHAR(512)
  `;

  await sql`
    ALTER TABLE user_skins ADD COLUMN skin_model VARCHAR(16)
  `;

  await sql`
    CREATE TABLE user_capes (
      id SERIAL PRIMARY KEY,
      user_uuid VARCHAR(32) NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `;

  await sql`
    CREATE INDEX user_capes_user_uuid_idx ON user_capes (user_uuid)
  `;
};

const down = async () => {
  await sql`DROP TABLE IF EXISTS user_capes`;
  await sql`ALTER TABLE user_skins DROP COLUMN IF EXISTS skin_model`;
  await sql`ALTER TABLE deleted_users DROP COLUMN IF EXISTS skin_model`;
  await sql`ALTER TABLE deleted_users DROP COLUMN IF EXISTS cape_url`;
};

export { up, down };
