import { Hono } from "hono";
import { logger } from "hono/logger";
import { config } from "./config";
import { processDocumentImagesRouter } from "./routes/processDocumentImages";

const app = new Hono();

app.use("*", logger());

app.get("/health", (c) => c.json({ status: "ok" }, 200));
app.route("/v1", processDocumentImagesRouter);

if (import.meta.main) {
  Bun.serve({
    port: config.PORT,
    fetch: app.fetch,
    reusePort: true,
  });

  console.info(`sbkl-pdf-image-service listening on :${config.PORT}`);
}

export default app;
