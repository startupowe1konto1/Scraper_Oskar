/**
 * Zod schemas mirroring our API contract.
 * Used inside API route handlers to validate request bodies before processing.
 */
import { z } from 'zod';

export const createQuerySchema = z.object({
  input: z.string().min(3).max(500).trim(),
  input_type: z.enum(['allegro_url', 'ean', 'product_url', 'auto']).default('auto'),
  context: z
    .object({
      seller_ref: z.string().optional(),
      display_name: z.string().optional(),
    })
    .optional(),
});

export type CreateQueryInput = z.infer<typeof createQuerySchema>;

export const createBatchQuerySchema = z.object({
  queries: z.array(createQuerySchema).min(1).max(200),
  batch_label: z.string().max(80).optional(),
});

export type CreateBatchQueryInput = z.infer<typeof createBatchQuerySchema>;

/**
 * Helper: validate JSON body with a Zod schema, return either result or error response shape.
 */
export async function parseRequestBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; status: number; body: any }> {
  try {
    const body = await req.json();
    const result = schema.safeParse(body);
    if (!result.success) {
      return {
        ok: false,
        status: 400,
        body: {
          error: {
            code: 'INVALID_INPUT',
            message: 'Request body did not match the expected schema',
            details: result.error.flatten(),
          },
        },
      };
    }
    return { ok: true, data: result.data };
  } catch (e: any) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON',
          details: e.message,
        },
      },
    };
  }
}
