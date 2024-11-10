import { Elysia } from "elysia";
import { list } from "../02-routes/index.js";

const router = new Elysia({ prefix: "/api" })
  .get("/plugin", () => "Hi")
  .get("/files", (all) => list.files.getFiles.default(all));

export default router;
