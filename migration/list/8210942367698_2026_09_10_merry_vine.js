import { sql } from "bun";
//Insert your migrate sql to quote
const up = async () => {
  await sql``;
};

//Insert your rollback migrate sql to quote
const down = async () => {
  await sql``;
};

export { up, down };
