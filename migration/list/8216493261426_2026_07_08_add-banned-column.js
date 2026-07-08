import { sql } from "bun";

const up = async () => {
  await sql`ALTER TABLE users ADD COLUMN banned BOOLEAN NOT NULL DEFAULT false`;
};

const down = async () => {
  await sql`ALTER TABLE users DROP COLUMN banned`;
};

export { up, down };
