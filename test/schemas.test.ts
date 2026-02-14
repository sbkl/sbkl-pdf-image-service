import { describe, expect, it } from "bun:test";
import {
  processDocumentImagesRequestSchema,
  processDocumentImagesResponseSchema,
} from "../src/schemas";

describe("schema validation", () => {
  it("accepts a valid request", () => {
    const parsed = processDocumentImagesRequestSchema.parse({
      requestId: "req_123",
      file: {
        storageId: "storage_123",
        url: "https://example.com/test.pdf",
        mimeType: "application/pdf",
      },
      images: [
        {
          documentSectionImageId: "img_1",
          placeholderId: "plot-1",
          pageIndex: 0,
          coordinates: [100, 120, 600, 700],
        },
      ],
    });

    expect(parsed.images.length).toBe(1);
  });

  it("accepts valid response payload", () => {
    const parsed = processDocumentImagesResponseSchema.parse({
      requestId: "req_123",
      results: [
        {
          documentSectionImageId: "img_1",
          status: "success",
          mimeType: "image/png",
          width: 120,
          height: 80,
          bytesBase64: "dGVzdA==",
          errorCode: null,
          errorMessage: null,
        },
        {
          documentSectionImageId: "img_2",
          status: "failed",
          mimeType: null,
          width: null,
          height: null,
          bytesBase64: null,
          errorCode: "CROP_FAILED",
          errorMessage: "bad coords",
        },
      ],
    });

    expect(parsed.results.length).toBe(2);
  });
});
