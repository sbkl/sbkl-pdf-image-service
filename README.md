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
    }
  ]
}
```

Failures are returned per image with `status: "failed"`.

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
