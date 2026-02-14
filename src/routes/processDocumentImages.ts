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

type ImageFailureCode =
  | "PDF_FETCH_FAILED"
  | "PAGE_RENDER_FAILED"
  | "REQUEST_DEADLINE_EXCEEDED"
  | "CROP_CONVERSION_FAILED"
  | "CROP_TOO_LARGE"
  | "CROP_FAILED";

function normalizeErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function toFailureResult(args: {
  documentSectionImageId: string;
  errorCode: ImageFailureCode;
  errorMessage: string;
}) {
  return {
    documentSectionImageId: args.documentSectionImageId,
    status: "failed" as const,
    mimeType: null,
    width: null,
    height: null,
    bytesBase64: null,
    errorCode: args.errorCode,
    errorMessage: args.errorMessage,
  };
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

  const startTime = Date.now();
  const elapsedMs = () => Date.now() - startTime;
  const remainingBudgetMs = () =>
    Math.max(0, config.REQUEST_DEADLINE_MS - elapsedMs());
  const deadlineExceeded = () => remainingBudgetMs() <= 0;
  const boundedTimeoutMs = (requestedTimeoutMs: number) =>
    Math.max(1, Math.min(requestedTimeoutMs, remainingBudgetMs()));

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
  const pdfFetchTimeoutMs = boundedTimeoutMs(config.PDF_FETCH_TIMEOUT_MS);
  try {
    pdf = await loadPdfFromUrl({
      url: request.file.url,
      timeoutMs: pdfFetchTimeoutMs,
      maxPdfBytes: config.MAX_PDF_BYTES,
    });
  } catch (error) {
    const errorCode: ImageFailureCode = deadlineExceeded()
      ? "REQUEST_DEADLINE_EXCEEDED"
      : "PDF_FETCH_FAILED";
    const errorMessage =
      `stage=pdf_fetch elapsedMs=${elapsedMs()} timeoutMs=${pdfFetchTimeoutMs} ` +
      `${normalizeErrorMessage(error)}`;
    for (const image of request.images) {
      results.push(
        toFailureResult({
          documentSectionImageId: image.documentSectionImageId,
          errorCode,
          errorMessage,
        }),
      );
    }

    return c.json(
      processDocumentImagesResponseSchema.parse({
        requestId: request.requestId,
        results,
      }),
    );
  }

  try {
    const pageEntries = Array.from(pageMap.entries()).sort((a, b) => a[0] - b[0]);

    for (let pagePointer = 0; pagePointer < pageEntries.length; pagePointer += 1) {
      const [pageIndex, images] = pageEntries[pagePointer]!;

      if (deadlineExceeded()) {
        const errorMessage =
          `stage=deadline_before_page elapsedMs=${elapsedMs()} deadlineMs=${config.REQUEST_DEADLINE_MS} pageIndex=${pageIndex}`;
        for (let remainingPointer = pagePointer; remainingPointer < pageEntries.length; remainingPointer += 1) {
          const [, remainingImages] = pageEntries[remainingPointer]!;
          for (const image of remainingImages) {
            results.push(
              toFailureResult({
                documentSectionImageId: image.documentSectionImageId,
                errorCode: "REQUEST_DEADLINE_EXCEEDED",
                errorMessage,
              }),
            );
          }
        }
        break;
      }

      let renderedPage;
      let pageRenderTimeoutMs = config.PAGE_RENDER_TIMEOUT_MS;
      try {
        pageRenderTimeoutMs = boundedTimeoutMs(config.PAGE_RENDER_TIMEOUT_MS);
        renderedPage = await renderPage({
          pdf,
          pageIndex,
          targetWidth: config.RENDER_TARGET_WIDTH,
          maxScale: config.MAX_RENDER_SCALE,
          pageRenderTimeoutMs,
          maxPagePixels: config.MAX_PAGE_PIXELS,
        });
      } catch (error) {
        const errorCode: ImageFailureCode = deadlineExceeded()
          ? "REQUEST_DEADLINE_EXCEEDED"
          : "PAGE_RENDER_FAILED";
        const errorMessage =
          `stage=page_render elapsedMs=${elapsedMs()} pageIndex=${pageIndex} ` +
          `timeoutMs=${pageRenderTimeoutMs} ` +
          `${normalizeErrorMessage(error)}`;
        for (const image of images) {
          results.push(
            toFailureResult({
              documentSectionImageId: image.documentSectionImageId,
              errorCode,
              errorMessage,
            }),
          );
        }
        continue;
      }

      for (const image of images) {
        if (deadlineExceeded()) {
          results.push(
            toFailureResult({
              documentSectionImageId: image.documentSectionImageId,
              errorCode: "REQUEST_DEADLINE_EXCEEDED",
              errorMessage:
                `stage=deadline_during_page elapsedMs=${elapsedMs()} deadlineMs=${config.REQUEST_DEADLINE_MS} pageIndex=${pageIndex}`,
            }),
          );
          continue;
        }

        let minY: number;
        let minX: number;
        let maxY: number;
        let maxX: number;

        try {
          [minY, minX, maxY, maxX] = normalizedBoxToPixelBox(
            image.coordinates as [number, number, number, number],
            renderedPage.width,
            renderedPage.height,
          );
        } catch (error) {
          results.push(
            toFailureResult({
              documentSectionImageId: image.documentSectionImageId,
              errorCode: "CROP_CONVERSION_FAILED",
              errorMessage:
                `stage=crop_conversion elapsedMs=${elapsedMs()} pageIndex=${pageIndex} coords=[${image.coordinates.join(",",
                )}] canvas=${renderedPage.width}x${renderedPage.height} ${normalizeErrorMessage(error)}`,
            }),
          );
          continue;
        }

        const cropWidth = maxX - minX;
        const cropHeight = maxY - minY;
        const cropPixels = cropWidth * cropHeight;

        if (cropPixels > config.MAX_CROP_PIXELS) {
          results.push(
            toFailureResult({
              documentSectionImageId: image.documentSectionImageId,
              errorCode: "CROP_TOO_LARGE",
              errorMessage:
                `stage=crop_validate elapsedMs=${elapsedMs()} pageIndex=${pageIndex} crop=${cropWidth}x${cropHeight} cropPixels=${cropPixels} maxCropPixels=${config.MAX_CROP_PIXELS}`,
            }),
          );
          continue;
        }

        try {
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
          results.push(
            toFailureResult({
              documentSectionImageId: image.documentSectionImageId,
              errorCode: "CROP_FAILED",
              errorMessage:
                `stage=crop_encode elapsedMs=${elapsedMs()} pageIndex=${pageIndex} crop=${cropWidth}x${cropHeight} ${normalizeErrorMessage(error)}`,
            }),
          );
        }
      }
    }
  } finally {
    await pdf.destroy();
  }

  console.info("process-document-images completed", {
    requestId: request.requestId,
    fileStorageId: request.file.storageId,
    total: request.images.length,
    success: results.filter((result) => result.status === "success").length,
    failed: results.filter((result) => result.status === "failed").length,
    elapsedMs: elapsedMs(),
  });

  return c.json(
    processDocumentImagesResponseSchema.parse({
      requestId: request.requestId,
      results,
    }),
  );
});

processDocumentImagesRouter.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json(
      {
        status: "error",
        code: error.status,
        message: error.message,
      },
      error.status,
    );
  }

  if (error instanceof ZodError) {
    return c.json(
      {
        status: "error",
        code: 400,
        message: "Invalid request payload",
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

  return c.json(
    {
      status: "error",
      code: status,
      message,
    },
    status,
  );
});
