export type NormalizedBox = [number, number, number, number];
export type PixelBox = [number, number, number, number];

function clampNormalizedCoordinate(value: number) {
  return Math.min(1000, Math.max(0, value));
}

export function normalizeBoxCoordinates(
  box: readonly [number, number, number, number],
): NormalizedBox {
  const rawY1 = clampNormalizedCoordinate(box[0]);
  const rawX1 = clampNormalizedCoordinate(box[1]);
  const rawY2 = clampNormalizedCoordinate(box[2]);
  const rawX2 = clampNormalizedCoordinate(box[3]);

  return [
    Math.min(rawY1, rawY2),
    Math.min(rawX1, rawX2),
    Math.max(rawY1, rawY2),
    Math.max(rawX1, rawX2),
  ];
}

function clampPixel(value: number, max: number) {
  return Math.min(max, Math.max(0, value));
}

export function normalizedBoxToPixelBox(
  box: readonly [number, number, number, number],
  pageWidth: number,
  pageHeight: number,
): PixelBox {
  if (!Number.isFinite(pageWidth) || !Number.isFinite(pageHeight)) {
    throw new Error("Invalid page dimensions");
  }
  if (pageWidth <= 0 || pageHeight <= 0) {
    throw new Error(`Invalid page dimensions: ${pageWidth}x${pageHeight}`);
  }

  const [minYNorm, minXNorm, maxYNorm, maxXNorm] = normalizeBoxCoordinates(box);

  const minY = clampPixel(
    Math.floor((minYNorm / 1000) * pageHeight),
    pageHeight,
  );
  const minX = clampPixel(Math.floor((minXNorm / 1000) * pageWidth), pageWidth);
  const maxY = clampPixel(
    Math.ceil((maxYNorm / 1000) * pageHeight),
    pageHeight,
  );
  const maxX = clampPixel(Math.ceil((maxXNorm / 1000) * pageWidth), pageWidth);

  if (minY >= maxY || minX >= maxX) {
    throw new Error(
      `Invalid crop region after conversion: [${minY}, ${minX}, ${maxY}, ${maxX}] for ${pageWidth}x${pageHeight}`,
    );
  }

  return [minY, minX, maxY, maxX];
}
