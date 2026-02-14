import { z } from "zod";

const envSchema = z.object({
  PROCESSOR_SECRET: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  MAX_IMAGES_PER_REQUEST: z.coerce.number().int().positive().default(500),
  MAX_PDF_BYTES: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  PDF_FETCH_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  RENDER_TARGET_WIDTH: z.coerce.number().int().positive().default(1800),
  MAX_RENDER_SCALE: z.coerce.number().positive().default(3),
  CROP_MARGIN_PX: z.coerce.number().int().min(0).default(20),
});

export const config = envSchema.parse({
  PROCESSOR_SECRET: process.env.PROCESSOR_SECRET,
  PORT: process.env.PORT,
  MAX_IMAGES_PER_REQUEST: process.env.MAX_IMAGES_PER_REQUEST,
  MAX_PDF_BYTES: process.env.MAX_PDF_BYTES,
  PDF_FETCH_TIMEOUT_MS: process.env.PDF_FETCH_TIMEOUT_MS,
  RENDER_TARGET_WIDTH: process.env.RENDER_TARGET_WIDTH,
  MAX_RENDER_SCALE: process.env.MAX_RENDER_SCALE,
  CROP_MARGIN_PX: process.env.CROP_MARGIN_PX,
});
