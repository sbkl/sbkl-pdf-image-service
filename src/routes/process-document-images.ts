import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import {
  processDocumentImageSchema,
  processDocumentImagesRequestSchema,
  processDocumentImagesResponseSchema,
  type ProcessDocumentImagesResponse,
} from "../schemas";
import { config } from "../config";
import { HTTPException } from "hono/http-exception";
import z from "zod";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createCanvas, DOMMatrix, Image, ImageData } from "canvas";

const globalRef = globalThis as {
  DOMMatrix?: typeof DOMMatrix;
  Image?: typeof Image;
  ImageData?: typeof ImageData;
};

if (!globalRef.DOMMatrix) {
  globalRef.DOMMatrix = DOMMatrix;
}
if (!globalRef.Image) {
  globalRef.Image = Image;
}
if (!globalRef.ImageData) {
  globalRef.ImageData = ImageData;
}

export const processDocumentImagesRouterV2 = new Hono();

processDocumentImagesRouterV2.post(
  "/process-document-images",
  zValidator("json", processDocumentImagesRequestSchema),
  async (ctx) => {
    const request = ctx.req.valid("json");

    if (request.images.length > config.MAX_IMAGES_PER_REQUEST) {
      throw new HTTPException(400, {
        message: `Too many images in request (${request.images.length} > ${config.MAX_IMAGES_PER_REQUEST})`,
      });
    }

    const pageMap = new Map<
      number,
      z.infer<typeof processDocumentImageSchema>[]
    >();
    for (const image of request.images) {
      const pageImages = pageMap.get(image.pageIndex);
      if (pageImages) {
        pageImages.push(image);
        continue;
      }
      pageMap.set(image.pageIndex, [image]);
    }

    const startTime = Date.now();
    const elapsedMs = () => Date.now() - startTime;
    const remainingBudgetMs = () =>
      Math.max(0, config.REQUEST_DEADLINE_MS - elapsedMs());
    const deadlineExceeded = () => remainingBudgetMs() <= 0;
    const boundedTimeoutMs = (requestedTimeoutMs: number) =>
      Math.max(1, Math.min(requestedTimeoutMs, remainingBudgetMs()));

    const pdfFetchTimeoutMs = boundedTimeoutMs(config.PDF_FETCH_TIMEOUT_MS);

    const pdfResponse = await fetch(request.file.url, {
      signal: AbortSignal.timeout(pdfFetchTimeoutMs),
    });

    const pdfBlob = await pdfResponse.blob();

    const pdfArrayBuffer = await pdfBlob.arrayBuffer();

    const pdf = await getDocument({
      data: pdfArrayBuffer,
    }).promise;

    const pageEntries = Array.from(pageMap.entries()).sort(
      (a, b) => a[0] - b[0],
    );

    const results: ProcessDocumentImagesResponse["results"] = [];

    for (
      let pagePointer = 0;
      pagePointer < pageEntries.length;
      pagePointer += 1
    ) {
      const [pageIndex, images] = z
        .tuple([z.number(), z.array(processDocumentImageSchema)])
        .parse(pageEntries[pagePointer]);

      const page = await pdf.getPage(pageIndex + 1);

      const unscaledViewport = page.getViewport({ scale: 1 });

      const scale = (request.targetWidth ?? 1200) / unscaledViewport.width;

      const viewport = page.getViewport({ scale });

      const canvasWidth = Math.max(1, Math.ceil(viewport.width));
      const canvasHeight = Math.max(1, Math.ceil(viewport.height));
      let canvas = createCanvas(canvasWidth, canvasHeight);
      let context = canvas.getContext("2d");

      try {
        await page.render({
          canvasContext: context,
          viewport,
          intent: "display",
        }).promise;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("Image or Canvas expected")) {
          throw error;
        }

        canvas = createCanvas(canvasWidth, canvasHeight);
        context = canvas.getContext("2d");
        await page.render({
          canvasContext: context,
          viewport,
          intent: "print",
        }).promise;
      }

      for (const image of images) {
        const [minY, minX, maxY, maxX] = image.coordinates;

        // Validate crop region
        if (
          minX < 0 ||
          minY < 0 ||
          maxX > canvas.width ||
          maxY > canvas.height ||
          minX >= maxX ||
          minY >= maxY
        ) {
          console.error("Invalid crop region:", {
            minX,
            minY,
            maxX,
            maxY,
            imageSize: { width: canvas.width, height: canvas.height },
          });
          throw new Error(
            `Invalid crop region: minX(${minX},${minY}) maxX(${maxX},${maxY}) for image ${canvas.width}×${canvas.height}`,
          );
        }
        const cropWidth = maxX - minX;
        const cropHeight = maxY - minY;

        // Add margin around the cropped image
        const margin = 20; // pixels of margin on each side
        const canvasWidth = cropWidth + margin * 2;
        const canvasHeight = cropHeight + margin * 2;

        const imageCanvas = createCanvas(canvasWidth, canvasHeight);

        const imageContext = imageCanvas.getContext("2d");

        // Fill canvas with white background
        imageContext.fillStyle = "white";
        imageContext.fillRect(0, 0, canvasWidth, canvasHeight);

        imageContext.drawImage(
          canvas, // source canvas
          minX, // source x
          minY, // source y
          cropWidth, // source width
          cropHeight, // source height
          margin, // destination x
          margin, // destination y
          cropWidth, // destination width
          cropHeight, // destination height
        );

        console.log("Cropped region:", {
          minX,
          minY,
          maxX,
          maxY,
          croppedSize: {
            width: cropWidth,
            height: cropHeight,
          },
        });
        const bytes = imageCanvas.toBuffer("image/png");

        results.push({
          documentSectionImageId: image.documentSectionImageId,
          status: "success",
          mimeType: "image/png",
          width: imageCanvas.width,
          height: imageCanvas.height,
          bytesBase64: Buffer.from(bytes).toString("base64"),
          errorCode: null,
          errorMessage: null,
        });
      }
    }

    return ctx.json(
      processDocumentImagesResponseSchema.parse({
        requestId: request.requestId,
        results,
      }),
    );
  },
);
