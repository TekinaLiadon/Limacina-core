import { Elysia } from "elysia";
import { list } from "../02-routes/index.js";

const router = new Elysia({ prefix: "/api" })
  .get("/plugin", () => "Hi")
    .get('/list', (all) => list.files.getFileList.default(all))
  .post("/files", (all) => list.files.getFiles.default(all))
    .get('/filesAsync', (all) => list.files.getAsyncFiles.default(all))

export default router;
