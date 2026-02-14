import { beforeEach, describe, expect, it, mock } from "bun:test";
import { PDFDocument, rgb } from "pdf-lib";

process.env.PROCESSOR_SECRET = "test-secret";
process.env.PORT = "3000";
process.env.MAX_IMAGES_PER_REQUEST = "20";
process.env.MAX_PDF_BYTES = String(20 * 1024 * 1024);
process.env.PDF_FETCH_TIMEOUT_MS = "5000";

const { default: app } = await import("../src/index");

async function createFixturePdf() {
  const pdfDoc = await PDFDocument.create();

  const page1 = pdfDoc.addPage([600, 800]);
  page1.drawRectangle({
    x: 100,
    y: 300,
    width: 300,
    height: 250,
    color: rgb(0.3, 0.6, 0.9),
  });

  const page2 = pdfDoc.addPage([500, 700]);
  page2.drawRectangle({
    x: 120,
    y: 120,
    width: 200,
    height: 200,
    color: rgb(0.8, 0.2, 0.2),
  });

  return await pdfDoc.save();
}

beforeEach(() => {
  mock.restore();
});

describe("POST /v1/process-document-images", () => {
  it("processes multi-page images and returns png payloads", async () => {
    const pdfBytes = await createFixturePdf();

    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://example.com/sample.pdf") {
        return new Response(pdfBytes, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
          },
        });
      }

      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;

    const response = await app.request(
      "http://localhost/v1/process-document-images",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-image-processor-secret": "test-secret",
        },
        body: JSON.stringify({
          requestId: "request_1",
          file: {
            storageId: "storage_1",
            url: "https://example.com/sample.pdf",
            mimeType: "application/pdf",
          },
          images: [
            {
              documentSectionImageId: "img_1",
              placeholderId: "shape-one",
              pageIndex: 0,
              coordinates: [300, 150, 650, 700],
            },
            {
              documentSectionImageId: "img_2",
              placeholderId: "shape-two",
              pageIndex: 1,
              coordinates: [300, 240, 900, 640],
            },
            {
              documentSectionImageId: "img_3",
              placeholderId: "bad",
              pageIndex: 0,
              coordinates: [100, 100, 100, 100],
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      requestId: string;
      results: Array<{
        status: "success" | "failed";
        errorCode: string | null;
        bytesBase64: string | null;
        mimeType: string | null;
        width: number | null;
        height: number | null;
      }>;
    };

    expect(payload.requestId).toBe("request_1");
    expect(payload.results).toHaveLength(3);

    const success = payload.results.filter((r) => r.status === "success");
    const failure = payload.results.filter((r) => r.status === "failed");

    expect(success).toHaveLength(2);
    expect(failure).toHaveLength(1);

    for (const item of success) {
      const pngBytes = Buffer.from(item.bytesBase64!, "base64");
      expect(item.mimeType).toBe("image/png");
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
      expect(pngBytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    }

    expect(failure[0]?.errorCode).toBe("CROP_FAILED");
  });
});
