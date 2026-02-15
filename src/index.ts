import { Hono } from "hono";
import { logger } from "hono/logger";
import { processDocumentImagesRouter } from "./routes/process-document-images";

const app = new Hono();

app.use("*", logger());

app.get("/health", (c) => c.json({ status: "ok" }, 200));
app.route("/v1", processDocumentImagesRouter);
export { app };
