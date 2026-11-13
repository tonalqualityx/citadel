/**
 * Card questions: the pure rules (no database). What a question must carry before the server stores it (the Context parts
 * Mike needs to answer it), the shapes the routes read and write, and the one citation line an agent may quote.
 *
 * The rule the server enforces so no agent can file a thin question: the question itself (one line, at most 200 characters,
 * ends in "?"), what it is, where it came from (sources), what was checked, what is unknown, what happens if nobody decides,
 * and, when options are offered, each option's consequence plus a recommendation and why. A "go with the recommendation"
 * default needs a recommended option to go with.
 */
import { z } from 'zod';

export const QUESTION_MAX = 200;
export const PART_MIN = 12;
export const PART_MAX = 2000;
export const OPTION_LABEL_MAX = 120;
export const OPEN_QUESTIONS_MAX = 10;
export const ANSWER_TEXT_MAX = 2000;
/** The timezone Mike's dates are written in. */
export const QUESTION_TZ = 'America/New_York';

/** A part that only says it has nothing to say is not a part. */
const EMPTY_PART = /^(n\/?a|none|nothing|unknown|tbd|todo|no|-+|\.+)\.?$/i;

function part(label: string) {
  return z
    .string({ error: `${label} is required.` })
    .transform((s) => s.replace(/\r\n?/g, '\n').trim())
    .refine((s) => s.length >= PART_MIN, { message: `${label} needs a real sentence (at least ${PART_MIN} characters).` })
    .refine((s) => !EMPTY_PART.test(s), { message: `${label} cannot be a placeholder.` })
    .refine((s) => s.length <= PART_MAX, { message: `${label} is too long (${PART_MAX} characters at most).` });
}

const sourceSchema = z
  .object({
    who: z.string().trim().min(2).max(120),
    said: z.string().trim().min(3).max(1000),
    at: z.string().trim().max(60).optional(),
    url: z.string().trim().max(500).optional(),
  })
  .strict();

const optionSchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9_-]{0,39}$/i, 'An option id is a short word, letters, numbers, _ or -.'),
    label: z.string().trim().min(1).max(OPTION_LABEL_MAX),
    consequence: part('Each option consequence'),
  })
  .strict();

export type QuestionSource = z.infer<typeof sourceSchema>;
export type QuestionOption = z.infer<typeof optionSchema>;

/** The Context parts and the question. Used whole for a new question and again after a PATCH merge. */
export const questionContextSchema = z
  .object({
    question: z
      .string({ error: 'The question is required.' })
      .trim()
      .min(5)
      .max(QUESTION_MAX, `The question is one line, ${QUESTION_MAX} characters at most.`)
      .refine((s) => !/[\r\n]/.test(s), { message: 'The question is one line, with no line breaks.' })
      .refine((s) => s.endsWith('?'), { message: 'The question ends in a question mark.' }),
    what_it_is: part('What it is'),
    sources: z.array(sourceSchema).min(1, 'Sources: say who said what, even if the source is your own reading.').max(10),
    checked: part('What was checked'),
    unknown: part('What is unknown'),
    options: z.array(optionSchema).max(4).optional().nullable(),
    recommended_option_id: z.string().trim().max(40).optional().nullable(),
    recommend_why: z.string().trim().max(PART_MAX).optional().nullable(),
    if_nobody: part('What happens if nobody decides'),
    if_nobody_action: z.enum(['go_with_recommendation', 'wait']),
  })
  .strict()
  .superRefine((q, ctx) => {
    const opts = q.options ?? [];
    if (opts.length === 1) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Offer two to four options, or none.' });
    const ids = new Set(opts.map((o) => o.id.toLowerCase()));
    if (ids.size !== opts.length) ctx.addIssue({ code: 'custom', path: ['options'], message: 'Option ids must be different.' });
    if (opts.length >= 2) {
      if (!q.recommended_option_id) ctx.addIssue({ code: 'custom', path: ['recommended_option_id'], message: 'With options, say which one you recommend.' });
      else if (!opts.some((o) => o.id === q.recommended_option_id)) ctx.addIssue({ code: 'custom', path: ['recommended_option_id'], message: 'The recommendation must be one of the options.' });
      if (!q.recommend_why || q.recommend_why.trim().length < PART_MIN || EMPTY_PART.test(q.recommend_why.trim())) {
        ctx.addIssue({ code: 'custom', path: ['recommend_why'], message: 'With options, say why you recommend that one.' });
      }
    } else if (q.recommended_option_id) {
      ctx.addIssue({ code: 'custom', path: ['recommended_option_id'], message: 'There are no options to recommend.' });
    }
    if (q.if_nobody_action === 'go_with_recommendation' && !q.recommended_option_id) {
      ctx.addIssue({ code: 'custom', path: ['if_nobody_action'], message: 'Going with the recommendation needs a recommended option. Use wait for an open question.' });
    }
  });
export type QuestionContext = z.infer<typeof questionContextSchema>;

/** PATCH: change the Context while the question is open (the merged result is checked whole), or withdraw it. */
export const questionPatchSchema = z
  .object({
    question: z.string().optional(),
    what_it_is: z.string().optional(),
    sources: z.array(z.unknown()).optional(),
    checked: z.string().optional(),
    unknown: z.string().optional(),
    options: z.array(z.unknown()).nullable().optional(),
    recommended_option_id: z.string().nullable().optional(),
    recommend_why: z.string().nullable().optional(),
    if_nobody: z.string().optional(),
    if_nobody_action: z.enum(['go_with_recommendation', 'wait']).optional(),
    withdraw: z.boolean().optional(),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: 'Say what to change.' });
export type QuestionPatch = z.infer<typeof questionPatchSchema>;

export const questionAnswerSchema = z
  .object({
    option_id: z.string().trim().min(1).max(40).optional(),
    text: z.string().max(ANSWER_TEXT_MAX).optional(),
  })
  .strict()
  .refine((b) => !!b.option_id || (b.text ?? '').trim() !== '', { message: 'Pick an option or write an answer.' });
export type QuestionAnswerBody = z.infer<typeof questionAnswerSchema>;

/** Plain-language problems of a question, one per line, for callers that want strings (the schema's issues, flattened). */
export function contextProblems(input: unknown): string[] {
  const r = questionContextSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

/** The words stored for an answer: the option label he picked, his own text, or both ("label: text"). */
export function answerWords(opt: QuestionOption | null, text: string): string {
  const t = text.replace(/\r\n?/g, '\n').trim();
  if (opt && t) return `${opt.label}: ${t}`;
  return opt ? opt.label : t;
}

export function citationDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: QUESTION_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** The one line an agent may quote: his exact words and the date. Null for anything that is not his answer. */
export function citationLine(q: { state: string; question: string; answer_text: string | null; answered_at: Date | null }): string | null {
  if (q.state !== 'answered' || !q.answer_text || !q.answered_at) return null;
  return `Mike, ${citationDate(q.answered_at)}, on "${q.question}": "${q.answer_text}"`;
}

/** The comment an answer leaves on the card. The id in chat_meta is what ties it back to its question. */
export function answerComment(question: string, words: string): string {
  return `Answer on "${question}": ${words}`;
}

export function optionOf(options: unknown, id: string | null | undefined): QuestionOption | null {
  if (!id || !Array.isArray(options)) return null;
  return (options as QuestionOption[]).find((o) => o && o.id === id) ?? null;
}
