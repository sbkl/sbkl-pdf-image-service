import {
  createCanvas,
  DOMMatrix,
  Image,
  ImageData,
  Path2D,
  type Canvas,
  type SKRSContext2D,
} from "@napi-rs/canvas";

const PATCH_FLAG = Symbol.for("pdfjs.napi.putImageDataPatched");

type PatchableContext = SKRSContext2D & {
  [PATCH_FLAG]?: boolean;
};

type CanvasEntry = {
  canvas: Canvas | null;
  context: SKRSContext2D | null;
};

export function installNapiPdfjsGlobals() {
  const globalRef = globalThis as {
    DOMMatrix?: typeof DOMMatrix;
    Image?: typeof Image;
    ImageData?: typeof ImageData;
    Path2D?: typeof Path2D;
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
  if (!globalRef.Path2D) {
    globalRef.Path2D = Path2D;
  }
}

export function getPatchedContext2D(canvas: Canvas): SKRSContext2D {
  const context = canvas.getContext("2d") as PatchableContext;

  if (!context[PATCH_FLAG]) {
    const originalPutImageData = context.putImageData.bind(context) as (
      ...args: any[]
    ) => void;

    context.putImageData = ((imageData: ImageData, ...rest: number[]) => {
      // Work around @napi-rs/canvas image corruption when pdf.js reuses
      // chunk buffers across sequential putImageData calls.
      const cloned = new ImageData(
        new Uint8ClampedArray(imageData.data),
        imageData.width,
        imageData.height,
      );
      originalPutImageData(cloned, ...rest);
    }) as SKRSContext2D["putImageData"];

    context[PATCH_FLAG] = true;
  }

  return context;
}

export class NapiCanvasFactory {
  constructor(_args?: { enableHWA?: boolean }) {}

  create(width: number, height: number): {
    canvas: Canvas;
    context: SKRSContext2D;
  } {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }

    const canvas = createCanvas(width, height);
    return {
      canvas,
      context: getPatchedContext2D(canvas),
    };
  }

  reset(canvasAndContext: CanvasEntry, width: number, height: number): void {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }

    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
    canvasAndContext.context = getPatchedContext2D(canvasAndContext.canvas);
  }

  destroy(canvasAndContext: CanvasEntry): void {
    if (!canvasAndContext.canvas) {
      throw new Error("Canvas is not specified");
    }

    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
    canvasAndContext.canvas = null;
    canvasAndContext.context = null;
  }
}
