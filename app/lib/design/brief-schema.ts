/**
 * Designer Portal v2: the `DesignBrief.body` schema of SPEC 4.1, validated in Citadel at publish (the box validates the
 * same shape with design_brief_check.py). Lengths are the spec's: headline at most 80 characters, summary at most 60
 * words, detail at most 1,200 words, 0 to 3 images per card.
 */
import { z } from 'zod';

export const BRIEF_SECTION_IDS = ['brand', 'client_said', 'audience', 'content_shape', 'industry', 'trends', 'references_preview', 'constraints'] as const;
export const MAX_BRIEF_BYTES = 512 * 1024;

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

const source = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('design_note'), id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('url'), url: z.string().url().startsWith('https://').max(500), accessed: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  z.object({ kind: z.literal('file'), path: z.string().min(1).max(500) }).strict(),
  z.object({ kind: z.literal('drive'), file_id: z.string().min(1).max(200), title: z.string().max(300).optional() }).strict(),
]);

const card = z.object({
  id: z.string().min(1).max(40),
  headline: z.string().min(1).max(80),
  summary: z.string().refine((s) => words(s) <= 60, 'summary is at most 60 words'),
  image_asset_ids: z.array(z.string().uuid()).max(3).default([]),
  detail_md: z.string().refine((s) => words(s) <= 1200, 'detail_md is at most 1,200 words').default(''),
  sources: z.array(source).max(20).default([]),
  confidence: z.enum(['confirmed', 'evidenced', 'inferred']),
}).strict();

export const briefBodySchema = z.object({
  version: z.literal(1),
  client: z.string().min(1).max(200),
  one_line: z.string().min(1).max(160),
  sections: z.array(z.object({
    id: z.enum(BRIEF_SECTION_IDS),
    title: z.string().min(1).max(100),
    cards: z.array(card).max(40),
  }).strict()).max(BRIEF_SECTION_IDS.length),
}).strict().superRefine((b, ctx) => {
  const ids = b.sections.map((s) => s.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', message: 'Duplicate section id' });
  const cardIds = b.sections.flatMap((s) => s.cards.map((c) => c.id));
  if (new Set(cardIds).size !== cardIds.length) ctx.addIssue({ code: 'custom', message: 'Duplicate card id' });
});

export type BriefBody = z.infer<typeof briefBodySchema>;
