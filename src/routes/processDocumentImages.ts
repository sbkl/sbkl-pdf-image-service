import { createCanvas } from "@napi-rs/canvas";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { config } from "../config";
import { normalizedBoxToPixelBox } from "../lib/crop";
import { loadPdfFromUrl, renderPage } from "../lib/pdf";
import {
  processDocumentImagesRequestSchema,
  processDocumentImagesResponseSchema,
  type ProcessDocumentImagesResponse,
} from "../schemas";

const retryableStatusCodes = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export const processDocumentImagesRouter = new Hono();

processDocumentImagesRouter.post("/process-document-images", async (c) => {
  const secret = c.req.header("x-image-processor-secret");
  if (!secret || secret !== config.PROCESSOR_SECRET) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const body = await c.req.json();
  const request = processDocumentImagesRequestSchema.parse(body);

  if (request.images.length > config.MAX_IMAGES_PER_REQUEST) {
    throw new HTTPException(400, {
      message: `Too many images in request (${request.images.length} > ${config.MAX_IMAGES_PER_REQUEST})`,
    });
  }

  const results: ProcessDocumentImagesResponse["results"] = [];

  const pageMap = new Map<number, typeof request.images>();
  for (const image of request.images) {
    const pageImages = pageMap.get(image.pageIndex);
    if (pageImages) {
      pageImages.push(image);
      continue;
    }
    pageMap.set(image.pageIndex, [image]);
  }

  let pdf;
  try {
    pdf = await loadPdfFromUrl({
      url: request.file.url,
      timeoutMs: config.PDF_FETCH_TIMEOUT_MS,
      maxPdfBytes: config.MAX_PDF_BYTES,
    });
  } catch (error) {
    const errorMessage = normalizeErrorMessage(error);
    for (const image of request.images) {
      results.push({
        documentSectionImageId: image.documentSectionImageId,
        status: "failed",
        mimeType: null,
        width: null,
        height: null,
        bytesBase64: null,
        errorCode: "PDF_FETCH_FAILED",
        errorMessage,
      });
    }

    return c.json(
      processDocumentImagesResponseSchema.parse({
        requestId: request.requestId,
        results,
      }),
    );
  }

  try {
    for (const [pageIndex, images] of pageMap.entries()) {
      let renderedPage;
      try {
        renderedPage = await renderPage({
          pdf,
          pageIndex,
          targetWidth: config.RENDER_TARGET_WIDTH,
          maxScale: config.MAX_RENDER_SCALE,
        });
      } catch (error) {
        const errorMessage = normalizeErrorMessage(error);
        for (const image of images) {
          results.push({
            documentSectionImageId: image.documentSectionImageId,
            status: "failed",
            mimeType: null,
            width: null,
            height: null,
            bytesBase64: null,
            errorCode: "PAGE_RENDER_FAILED",
            errorMessage,
          });
        }
        continue;
      }

      for (const image of images) {
        try {
          const [minY, minX, maxY, maxX] = normalizedBoxToPixelBox(
            image.coordinates as [number, number, number, number],
            renderedPage.width,
            renderedPage.height,
          );

          const cropWidth = maxX - minX;
          const cropHeight = maxY - minY;

          const margin = config.CROP_MARGIN_PX;
          const outputWidth = cropWidth + margin * 2;
          const outputHeight = cropHeight + margin * 2;

          const outputCanvas = createCanvas(outputWidth, outputHeight);
          const outputContext = outputCanvas.getContext("2d");

          outputContext.imageSmoothingEnabled = true;
          outputContext.imageSmoothingQuality = "high";
          outputContext.fillStyle = "#ffffff";
          outputContext.fillRect(0, 0, outputWidth, outputHeight);

          outputContext.drawImage(
            renderedPage.canvas,
            minX,
            minY,
            cropWidth,
            cropHeight,
            margin,
            margin,
            cropWidth,
            cropHeight,
          );

          const bytes = outputCanvas.toBuffer("image/png");

          results.push({
            documentSectionImageId: image.documentSectionImageId,
            status: "success",
            mimeType: "image/png",
            width: outputWidth,
            height: outputHeight,
            bytesBase64: Buffer.from(bytes).toString("base64"),
            errorCode: null,
            errorMessage: null,
          });
        } catch (error) {
          results.push({
            documentSectionImageId: image.documentSectionImageId,
            status: "failed",
            mimeType: null,
            width: null,
            height: null,
            bytesBase64: null,
            errorCode: "CROP_FAILED",
            errorMessage: normalizeErrorMessage(error),
          });
        }
      }
    }
  } finally {
    await pdf.destroy();
  }

  return c.json(
    processDocumentImagesResponseSchema.parse({
      requestId: request.requestId,
      results,
    }),
  );
});

processDocumentImagesRouter.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ errorMessage: error.message }, error.status);
  }

  if (error instanceof ZodError) {
    return c.json(
      {
        errorMessage: "Invalid request payload",
        issues: error.issues,
      },
      400,
    );
  }

  const message = normalizeErrorMessage(error);

  const status =
    error instanceof Error &&
    retryableStatusCodes.has(Number((error as Error & { status?: number }).status))
      ? 503
      : 500;

  return c.json({ errorMessage: message }, status);
});
