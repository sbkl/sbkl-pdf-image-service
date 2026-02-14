# sbkl-pdf-image-service

Bun + Hono service that receives a PDF URL and a batch of image crop requests, renders pages with `pdfjs-dist` + `@napi-rs/canvas`, and returns per-image PNG payloads.

## Endpoints

- `GET /health`
- `POST /v1/process-document-images`

### Auth

`POST /v1/process-document-images` requires header:

- `x-image-processor-secret: <PROCESSOR_SECRET>`

### Request

```json
{
  "requestId": "req_123",
  "file": {
    "storageId": "storage_abc",
    "url": "https://...",
    "mimeType": "application/pdf"
  },
  "images": [
    {
      "documentSectionImageId": "img_1",
      "placeholderId": "diagram-1",
      "pageIndex": 0,
      "coordinates": [100, 200, 800, 900]
    }
  ]
}
```

Coordinates are normalized `[minY, minX, maxY, maxX]` in the `0..1000` space.

### Response

```json
{
  "requestId": "req_123",
  "results": [
    {
      "documentSectionImageId": "img_1",
      "status": "success",
      "mimeType": "image/png",
      "width": 420,
      "height": 350,
      "bytesBase64": "...",
      "errorCode": null,
      "errorMessage": null
    },
    {
      "documentSectionImageId": "img_2",
      "status": "failed",
      "mimeType": null,
      "width": null,
      "height": null,
      "bytesBase64": null,
      "errorCode": "PAGE_RENDER_FAILED",
      "errorMessage": "stage=page_render elapsedMs=3112 pageIndex=2 Page render timeout after 7500ms"
    }
  ]
}
```

## Error Semantics

The service returns per-image error codes, so failures are actionable:

- `PDF_FETCH_FAILED`
- `PAGE_RENDER_FAILED`
- `REQUEST_DEADLINE_EXCEEDED`
- `CROP_CONVERSION_FAILED`
- `CROP_TOO_LARGE`
- `CROP_FAILED`

`errorMessage` always includes stage metadata (`stage`, `elapsedMs`, `pageIndex`, dimensions/coords when relevant).

## Rendering Quality

The service renders each page once and crops from that rendered page:

- `RENDER_TARGET_WIDTH` controls output detail (default `1400`)
- `MAX_RENDER_SCALE` caps upscaling factor (default `2`)
- `CROP_MARGIN_PX` adds a white border around each crop (default `20`)
- `MAX_PAGE_PIXELS` bounds compute and may automatically reduce scale for large pages

For a balanced quality/performance profile, start with `RENDER_TARGET_WIDTH=1400`, `MAX_RENDER_SCALE=2`, and `MAX_PAGE_PIXELS=20000000`.

## Reliability / Guardrails

To prevent opaque platform timeouts, the service can fail early with explicit errors:

- `REQUEST_DEADLINE_MS` total request budget before forced per-image timeout failures
- `PAGE_RENDER_TIMEOUT_MS` max render time per page
- `MAX_PAGE_PIXELS` max rendered page area
- `MAX_CROP_PIXELS` max crop area

## Local Development

```bash
bun install
cp .env.example .env
bun run dev
```

## Tests

```bash
bun test
bun run typecheck
```

## Railway

Use Docker deploy (`railway.toml` + `Dockerfile`) and set env vars:

- `PROCESSOR_SECRET`
- `PORT` (Railway also injects this)
- `MAX_IMAGES_PER_REQUEST`
- `MAX_PDF_BYTES`
- `PDF_FETCH_TIMEOUT_MS`
- `RENDER_TARGET_WIDTH`
- `MAX_RENDER_SCALE`
- `CROP_MARGIN_PX`
- `REQUEST_DEADLINE_MS`
- `PAGE_RENDER_TIMEOUT_MS`
- `MAX_PAGE_PIXELS`
- `MAX_CROP_PIXELS`
