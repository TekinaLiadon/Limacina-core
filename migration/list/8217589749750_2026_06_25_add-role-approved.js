import { sql } from "bun";

const up = async () => {
  await sql`ALTER TABLE users ADD COLUMN role VARCHAR(32) NOT NULL DEFAULT 'user'`;
  await sql`ALTER TABLE users ADD COLUMN approved BOOLEAN NOT NULL DEFAULT false`;
};

const down = async () => {
  await sql`ALTER TABLE users DROP COLUMN approved`;
  await sql`ALTER TABLE users DROP COLUMN role`;
};

export { up, down };
