// The page the designer is looking at, sent with every chat message so the worker knows where an instruction applies.
import { z } from 'zod';

export const pageContextSchema = z
  .object({
    path: z.string().min(1).max(500).regex(/^\/(?!\/)\S*$/, 'path must start with a single / and hold no whitespace'),
    viewport_w: z.number().int().min(200).max(4000),
    preview_sha: z.string().max(64).optional(),
  })
  .strict();
export type PageContext = z.infer<typeof pageContextSchema>;

/** Client side: a context the route will accept, or undefined (never block a send over it). */
export function toPageContext(path: string | null | undefined, width: number | null | undefined, previewSha?: string | null): PageContext | undefined {
  if (!path || !width) return undefined;
  const candidate = { path: path.split('#')[0], viewport_w: Math.round(width), ...(previewSha ? { preview_sha: previewSha.slice(0, 64) } : {}) };
  const parsed = pageContextSchema.safeParse(candidate);
  return parsed.success ? parsed.data : undefined;
}
