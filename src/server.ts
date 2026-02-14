import { serve } from "@hono/node-server";
import { config } from "./config";
import { app } from "./index";

serve({
  fetch: app.fetch,
  port: config.PORT,
});

console.info(`sbkl-pdf-image-service listening on :${config.PORT}`);
