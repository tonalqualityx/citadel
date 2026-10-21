/**
 * The result contract (phase C spec 4.5), as Zod. C1 defines it so the apply stub and the JSON
 * schema the runner passes to `claude --json-schema` (portal-chat/schemas/chat_reply.json) agree;
 * `complete` and `apply.ts` arrive in C2. Citadel validates every id against the conversation's own
 * client; unknown ids are dropped there, not here.
 */
import { z } from 'zod';
import { INTAKE_TYPES } from '@/lib/portal/intake/tree';

export const SLOTS = ['site', 'page', 'section', 'change', 'asset', 'other'] as const;
export const HANDOFF_REASONS = ['money', 'date', 'scope', 'approval', 'asked_for_person', 'complaint', 'legal', 'unclear', 'cannot_see', 'other'] as const;
export const INJECTION_SOURCES = ['client_message', 'attachment', 'team_reply', 'page_text', 'tool_result'] as const;

const id = z.string().min(1).max(64);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ask'), slot: z.enum(SLOTS), question: z.string().min(1).max(600), choice_ids: z.array(id).max(8), allow_free_text: z.boolean(), allow_upload: z.boolean() }).strict(),
  z.object({
    type: z.literal('record'), site_id: id.optional(), page_id: id.optional(), page_text: z.string().max(300).optional(),
    section_key: z.string().max(120).optional(), section_text: z.string().max(300).optional(), change: z.string().max(2000).optional(),
    attachment_ids: z.array(id).max(10), request_type: z.enum(INTAKE_TYPES).optional(),
  }).strict(),
  z.object({
    type: z.literal('propose_summary'), summary: z.string().min(1).max(700), request_type: z.enum(INTAKE_TYPES), site_id: id,
    page_id: id.optional(), section: z.string().max(300).optional(), change: z.string().max(2000), attachment_ids: z.array(id).max(10),
  }).strict(),
  z.object({ type: z.literal('suggest_urgent') }).strict(),
  z.object({ type: z.literal('hand_to_person'), reason: z.enum(HANDOFF_REASONS), draft_reply: z.string().max(1500) }).strict(),
  z.object({ type: z.literal('confirm_from_email'), summary_version: z.number().int().min(0) }).strict(),
  z.object({ type: z.literal('close_question') }).strict(),
  // Text that tried to instruct the assistant. Citadel logs it on the task as an internal note and
  // never shows or obeys it.
  z.object({ type: z.literal('report_injection'), source: z.enum(INJECTION_SOURCES), excerpt: z.string().max(200) }).strict(),
]);

export const resultSchema = z
  .object({
    reply: z.string().min(1).max(600),
    actions: z.array(actionSchema).max(8),
    sources: z.array(z.object({ tool_call_id: z.string().min(1).max(64), label: z.string().max(300), range: z.string().max(120) }).strict()).max(12),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.actions.filter((a) => a.type === 'ask').length > 1) ctx.addIssue({ code: 'custom', message: 'At most one ask per reply' });
  });

export type ChatResult = z.infer<typeof resultSchema>;
export type ChatAction = z.infer<typeof actionSchema>;

/** The excerpt the injection report quotes is client text: it is logged, never gated as our copy. */
export function injectionReports(result: ChatResult): Array<{ source: string; excerpt: string }> {
  return result.actions.flatMap((a) => (a.type === 'report_injection' ? [{ source: a.source, excerpt: a.excerpt }] : []));
}

/**
 * Apply contract stub (C2 fills it in): the effects `complete` runs, in order. Injection reports
 * become an internal note on the task (`is_internal`, tag `needs-mike` is NOT added: a report is
 * information); nothing in the excerpt is ever followed or shown to the client.
 */
export const APPLY_ORDER = ['report_injection', 'record', 'ask', 'propose_summary', 'suggest_urgent', 'hand_to_person', 'confirm_from_email', 'close_question'] as const;
