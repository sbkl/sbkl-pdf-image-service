import {
  createCanvas,
  DOMMatrix,
  Image,
  ImageData,
  type Canvas,
  type CanvasRenderingContext2D,
} from "canvas";
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";

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

export async function loadPdfFromUrl(args: {
  url: string;
  timeoutMs: number;
  maxPdfBytes: number;
}) {
  const response = await fetch(args.url, {
    signal: AbortSignal.timeout(args.timeoutMs),
  });

  if (!response.ok) {
    throw new Error(`Unable to fetch PDF: HTTP ${response.status}`);
  }

  const pdfBytes = new Uint8Array(await response.arrayBuffer());
  if (pdfBytes.byteLength === 0) {
    throw new Error("Downloaded PDF is empty");
  }

  if (pdfBytes.byteLength > args.maxPdfBytes) {
    throw new Error(
      `PDF exceeds max size (${pdfBytes.byteLength} > ${args.maxPdfBytes})`,
    );
  }

  const signature = String.fromCharCode(...pdfBytes.slice(0, 4));
  if (signature !== "%PDF") {
    throw new Error("Invalid PDF signature");
  }

  return await getDocument({
    data: pdfBytes,
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
    stopAtErrors: true,
  } as any).promise;
}

function renderPageWithTimeout(args: {
  page: PDFPageProxy;
  canvasContext: CanvasRenderingContext2D;
  viewport: ReturnType<PDFPageProxy["getViewport"]>;
  timeoutMs: number;
  intent?: "display" | "print";
}) {
  const renderTask = args.page.render({
    canvasContext: args.canvasContext as any,
    viewport: args.viewport,
    intent: args.intent,
  } as any);

  return Promise.race([
    renderTask.promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => {
        renderTask.cancel();
        reject(new Error(`Page render timeout after ${args.timeoutMs}ms`));
      }, args.timeoutMs);
    }),
  ]);
}

export async function renderPageAtScaleOne(args: {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  pageRenderTimeoutMs: number;
  maxPagePixels: number;
}): Promise<{
  canvas: Canvas;
  context: CanvasRenderingContext2D;
  width: number;
  height: number;
}> {
  if (args.pageIndex < 0 || args.pageIndex >= args.pdf.numPages) {
    throw new Error(
      `Page index ${args.pageIndex} is out of bounds for PDF with ${args.pdf.numPages} pages`,
    );
  }

  const page = await args.pdf.getPage(args.pageIndex + 1);
  const viewport = page.getViewport({ scale: 1 });

  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));
  if (width * height > args.maxPagePixels) {
    throw new Error(
      `Rendered page exceeds max pixels: ${width}x${height} > ${args.maxPagePixels}`,
    );
  }

  const canvas = createCanvas(width, height);
  let context = canvas.getContext("2d");

  try {
    await renderPageWithTimeout({
      page,
      canvasContext: context,
      viewport,
      timeoutMs: args.pageRenderTimeoutMs,
      intent: "display",
    });

    return {
      canvas,
      context,
      width,
      height,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("Image or Canvas expected")) {
      throw error;
    }

    // Fallback for node-canvas drawImage type mismatches in some PDFs.
    const retryCanvas = createCanvas(width, height);
    context = retryCanvas.getContext("2d");
    await renderPageWithTimeout({
      page,
      canvasContext: context,
      viewport,
      timeoutMs: args.pageRenderTimeoutMs,
      intent: "print",
    });

    return {
      canvas: retryCanvas,
      context,
      width,
      height,
    };
  }
}
