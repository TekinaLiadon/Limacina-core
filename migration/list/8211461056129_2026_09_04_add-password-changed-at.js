import { sql } from "bun";

const up = async () => {
  await sql`
    ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMPTZ
  `;

  await sql`
    ALTER TABLE deleted_users ADD COLUMN password_changed_at TIMESTAMPTZ
  `;
};

const down = async () => {
  await sql`ALTER TABLE deleted_users DROP COLUMN IF EXISTS password_changed_at`;
  await sql`ALTER TABLE users DROP COLUMN IF EXISTS password_changed_at`;
};

export { up, down };
