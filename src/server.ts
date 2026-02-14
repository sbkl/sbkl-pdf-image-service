import { serve } from "@hono/node-server";
import { config } from "./config";
import { app } from "./index";

serve({
  fetch: app.fetch,
  port: config.PORT,
  hostname: "0.0.0.0",
});

console.info(`sbkl-pdf-image-service listening on 0.0.0.0:${config.PORT}`);
