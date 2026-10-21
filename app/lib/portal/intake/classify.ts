/**
 * The model slot (portal phase B slice 1, spec 2.7). Ships OFF.
 *
 * `classifyIntake` returns null unless PORTAL_INTAKE_LLM is true AND ANTHROPIC_API_KEY is set.
 * When on, it runs only for the "Something else" type and calls the Sonnet tier with plain
 * `fetch` (no SDK, no new dependency). The result is stored as `suggested_type` plus a
 * `suggested:{type}` tag. It is never shown to the client and never changes placement.
 * With the flag off, no network call is ever made.
 */
import { PORTAL_INTAKE_LLM } from '@/lib/config/feature-flags';
import { INTAKE_TYPES, isIntakeType, type IntakeType } from './tree';

export interface ClassifyContext {
  type: IntakeType;
}

/** Capability alias for the Sonnet tier, resolved by env so a model rename needs no code change. */
const DEFAULT_MODEL = 'claude-sonnet-4-5';

export async function classifyIntake(
  text: string,
  ctx: ClassifyContext,
  opts: { enabled?: boolean } = {}
): Promise<IntakeType | null> {
  const enabled = opts.enabled ?? PORTAL_INTAKE_LLM;
  const key = process.env.ANTHROPIC_API_KEY;
  if (!enabled || !key) return null;
  if (ctx.type !== 'other') return null;
  const trimmed = text.trim().slice(0, 2000);
  if (!trimmed) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: process.env.PORTAL_INTAKE_MODEL || DEFAULT_MODEL,
        max_tokens: 20,
        system:
          'Classify a website client request into exactly one of: ' +
          INTAKE_TYPES.filter((t) => t !== 'other').join(', ') +
          '. Reply with the single key only.',
        messages: [{ role: 'user', content: trimmed }],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const answer = body.content?.find((c) => c.type === 'text')?.text?.trim() ?? '';
    return isIntakeType(answer) && answer !== 'other' ? answer : null;
  } catch {
    return null;
  }
}
