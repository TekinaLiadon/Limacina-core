import { sql } from "bun";

const up = async () => {
  await sql`
    CREATE INDEX user_skins_user_uuid_idx ON user_skins (user_uuid)
  `;

  await sql`
    CREATE INDEX user_models_user_uuid_idx ON user_models (user_uuid)
  `;

  await sql`
    CREATE INDEX deleted_users_deleted_at_idx ON deleted_users (deleted_at)
  `;
};

const down = async () => {
  await sql`DROP INDEX IF EXISTS deleted_users_deleted_at_idx`;
  await sql`DROP INDEX IF EXISTS user_models_user_uuid_idx`;
  await sql`DROP INDEX IF EXISTS user_skins_user_uuid_idx`;
};

export { up, down };
