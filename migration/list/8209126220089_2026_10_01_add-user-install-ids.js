import { sql } from "bun";

const up = async () => {
  await sql`
    CREATE TABLE user_install_ids (
      user_uuid VARCHAR(32) NOT NULL REFERENCES users(uuid) ON DELETE CASCADE,
      install_id TEXT NOT NULL,
      install_id_history TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (user_uuid)
    )
  `;
};

const down = async () => {
  await sql`DROP TABLE IF EXISTS user_install_ids`;
};

export { up, down };
