import { sql } from "bun";

const up = async () => {
  await sql`
    ALTER TABLE user_skins ADD COLUMN active BOOLEAN NOT NULL DEFAULT FALSE
  `;

  await sql`
    CREATE INDEX user_skins_active_idx ON user_skins (user_uuid, active)
  `;
};

const down = async () => {
  await sql`DROP INDEX IF EXISTS user_skins_active_idx`;
  await sql`ALTER TABLE user_skins DROP COLUMN IF EXISTS active`;
};

export { up, down };
