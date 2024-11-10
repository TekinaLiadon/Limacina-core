import { Elysia } from "elysia";
import { createClient } from "redis";

export default (app: Elysia) => {
  if ("redis" in app.store) return app;
  const client = createClient();
  client.on("error", (err) => console.log("Redis Client Error", err));
  return app.state("redis", client);
};
