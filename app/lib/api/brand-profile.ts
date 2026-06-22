import { z } from 'zod';
import { Prisma } from '@prisma/client';

/**
 * Shared validation + Prisma-data shaping for BrandProfile upserts (client + site owners).
 * voice_profile / brand_tokens are freeform JSON in v1 (z.any). figma_url / component_library_ref /
 * notes are plain strings. Every field is optional so the PUT acts as a partial upsert.
 */
export const brandProfileInputSchema = z.object({
  voice_profile: z.any().optional(),
  figma_url: z.string().max(500).optional().nullable(),
  component_library_ref: z.string().max(255).optional().nullable(),
  brand_tokens: z.any().optional(),
  notes: z.string().optional().nullable(),
});

export type BrandProfileInput = z.infer<typeof brandProfileInputSchema>;

/**
 * Turn validated input into a Prisma data object. Omits fields not present in the request (leaves
 * them untouched on update), and maps an explicit `null` on a JSON field to `Prisma.DbNull` so the
 * column is cleared (Prisma rejects a bare `null` on a nullable Json field).
 */
export function buildBrandProfileData(input: BrandProfileInput): Record<string, unknown> {
  const data: Record<string, unknown> = {};

  if ('figma_url' in input) data.figma_url = input.figma_url ?? null;
  if ('component_library_ref' in input)
    data.component_library_ref = input.component_library_ref ?? null;
  if ('notes' in input) data.notes = input.notes ?? null;

  if ('voice_profile' in input)
    data.voice_profile = input.voice_profile == null ? Prisma.DbNull : input.voice_profile;
  if ('brand_tokens' in input)
    data.brand_tokens = input.brand_tokens == null ? Prisma.DbNull : input.brand_tokens;

  return data;
}
