import {
  createCanvas,
  DOMMatrix,
  ImageData,
  Path2D,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";
import { getDocument, type PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

const globalRef = globalThis as {
  DOMMatrix?: typeof DOMMatrix;
  ImageData?: typeof ImageData;
  Path2D?: typeof Path2D;
};

if (!globalRef.DOMMatrix) {
  globalRef.DOMMatrix = DOMMatrix;
}
if (!globalRef.ImageData) {
  globalRef.ImageData = ImageData;
}
if (!globalRef.Path2D) {
  globalRef.Path2D = Path2D;
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

export async function renderPage(args: {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  targetWidth: number;
  maxScale: number;
}): Promise<{
  canvas: Canvas;
  context: SKRSContext2D;
  width: number;
  height: number;
  scale: number;
}> {
  if (args.pageIndex < 0 || args.pageIndex >= args.pdf.numPages) {
    throw new Error(
      `Page index ${args.pageIndex} is out of bounds for PDF with ${args.pdf.numPages} pages`,
    );
  }

  const page = await args.pdf.getPage(args.pageIndex + 1);
  const baseViewport = page.getViewport({ scale: 1 });

  const requestedScale = args.targetWidth / baseViewport.width;
  const scale = Math.min(args.maxScale, Math.max(1, requestedScale));
  const viewport = page.getViewport({ scale });

  const width = Math.max(1, Math.ceil(viewport.width));
  const height = Math.max(1, Math.ceil(viewport.height));

  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");

  // Match client behavior where page backgrounds are treated as white.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  await page
    .render({
      canvasContext: context as any,
      viewport,
    } as any)
    .promise;

  return {
    canvas,
    context,
    width,
    height,
    scale,
  };
}
