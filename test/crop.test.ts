import { describe, expect, it } from "vitest";
import {
  normalizeBoxCoordinates,
  normalizedBoxToPixelBox,
} from "../src/lib/crop";

describe("crop conversion", () => {
  it("normalizes and reorders coordinates", () => {
    expect(normalizeBoxCoordinates([1100, -20, 300, 1200])).toEqual([
      300,
      0,
      1000,
      1000,
    ]);
  });

  it("converts normalized box to pixel box", () => {
    expect(normalizedBoxToPixelBox([100, 200, 900, 800], 1000, 500)).toEqual([
      50,
      200,
      450,
      800,
    ]);
  });

  it("throws when crop area is invalid", () => {
    expect(() => normalizedBoxToPixelBox([100, 100, 100, 100], 1000, 500)).toThrow(
      "Invalid crop region",
    );
  });
});
