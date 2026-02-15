import { Hono } from "hono";
import { logger } from "hono/logger";
import { processDocumentImagesRouter } from "./routes/processDocumentImages";
import { processDocumentImagesRouterV2 } from "./routes/process-document-images";

const app = new Hono();

app.use("*", logger());

app.get("/health", (c) => c.json({ status: "ok" }, 200));
app.route("/v1", processDocumentImagesRouter);

app.route("/v2", processDocumentImagesRouterV2);
export { app };
