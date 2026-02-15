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
import { createCanvas, Image } from "canvas";

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

    const pdf = await getDocument({ data: pdfArrayBuffer }).promise;

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

      const canvas = createCanvas(viewport.width, viewport.height);

      const context = canvas.getContext("2d");

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise;

      const dataURL = canvas.toDataURL("image/png");
      console.log("dataURL", dataURL);

      function dataURLToBlob(dataURL: string) {
        const parts = dataURL.split(";base64,");
        const contentType = parts[0]?.split(":")[1];
        const bufferSrc = parts[1];

        if (!bufferSrc) throw new Error("Invalid data URL");
        const raw = Buffer.from(bufferSrc, "base64");
        const blob = new Blob([raw], { type: contentType });
        return blob;
      }

      const pageBlob = dataURLToBlob(dataURL);

      console.log("pageBlob", pageBlob);

      const imageUrl = URL.createObjectURL(pageBlob);
      const img = new Image();

      // Load the image
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("Failed to load image"));
        img.src = imageUrl;
      });

      URL.revokeObjectURL(imageUrl);

      for (const image of images) {
        const [minY, minX, maxY, maxX] = image.coordinates;

        // Validate crop region
        if (
          minX < 0 ||
          minY < 0 ||
          maxX > img.width ||
          maxY > img.height ||
          minX >= maxX ||
          minY >= maxY
        ) {
          console.error("Invalid crop region:", {
            minX,
            minY,
            maxX,
            maxY,
            imageSize: { width: img.width, height: img.height },
          });
          throw new Error(
            `Invalid crop region: minX(${minX},${minY}) maxX(${maxX},${maxY}) for image ${img.width}×${img.height}`,
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
          0, // destination x
          0, // destination y
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
        const imageDataURL = imageCanvas.toDataURL("image/png");
        console.log("imageDataURL", imageDataURL);

        const imageCanvasBlob = dataURLToBlob(imageDataURL);
        console.log("imageCanvasBlob", imageCanvasBlob);

        async function processFile(
          file: File | Blob,
          { throwError = false }: { throwError?: boolean } = {},
        ) {
          // 5 MB limit guard
          if (file.size > 5 * 1024 * 1024 && throwError) {
            throw new Error("File must be 5 MB or less");
          }
          const fileBuffer = await file.arrayBuffer();

          const hashBuffer = await crypto.subtle.digest("SHA-256", fileBuffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const sha256 = hashArray
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");

          return {
            fileBuffer,
            sha256,
            mimetype: file.type,
            filename: file instanceof File ? file.name : "Unknown",
          };
        }

        const { fileBuffer, mimetype } = await processFile(imageCanvasBlob, {
          throwError: true,
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
