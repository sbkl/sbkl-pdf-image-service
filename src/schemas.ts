import { z } from "zod";

export const coordinatesSchema = z.tuple([
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
  z.number().min(0).max(1000),
]);

export const processDocumentImageSchema = z.object({
  documentSectionImageId: z.string().min(1),
  placeholderId: z.string().min(1),
  pageIndex: z.number().int().min(0),
  coordinates: coordinatesSchema,
});

export const processDocumentImagesRequestSchema = z.object({
  requestId: z.string().min(1),
  file: z.object({
    storageId: z.string().min(1),
    url: z.url(),
    mimeType: z.string().min(1),
  }),
  images: z.array(processDocumentImageSchema),
  targetWidth: z.number().int().positive().optional(),
});

export const processDocumentImageSuccessSchema = z.object({
  documentSectionImageId: z.string().min(1),
  status: z.literal("success"),
  mimeType: z.literal("image/png"),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytesBase64: z.string().min(1),
  errorCode: z.null(),
  errorMessage: z.null(),
});

export const processDocumentImageFailureSchema = z.object({
  documentSectionImageId: z.string().min(1),
  status: z.literal("failed"),
  mimeType: z.null(),
  width: z.null(),
  height: z.null(),
  bytesBase64: z.null(),
  errorCode: z.string().min(1),
  errorMessage: z.string().min(1),
});

export const processDocumentImagesResponseSchema = z.object({
  requestId: z.string().min(1),
  results: z.array(
    z.union([
      processDocumentImageSuccessSchema,
      processDocumentImageFailureSchema,
    ]),
  ),
});

export type ProcessDocumentImagesRequest = z.infer<
  typeof processDocumentImagesRequestSchema
>;

export type ProcessDocumentImagesResponse = z.infer<
  typeof processDocumentImagesResponseSchema
>;
