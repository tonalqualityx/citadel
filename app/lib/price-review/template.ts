/**
 * The price review note, as a fixed template. The only inputs are the first name, the plan name
 * the client already sees, and the terms Mike approved. There is no free text and no default
 * amount: with no approved terms the render throws and nothing can be queued.
 *
 * Writing rules (writing-standard): plain words, short sentences, no dashes used as punctuation,
 * no discount language, no promises beyond the date and the amount Mike approved.
 */
import { approvedTermsSchema, startDateProblem, type ApprovedTerms } from './terms';

export class PriceReviewRenderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PriceReviewRenderError';
  }
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** "2026-11-01" to "November 1, 2026". Pure string math: no time zone can shift the day. */
export function longDate(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new PriceReviewRenderError(`Not a date: ${isoDate}`);
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

/** 15000 to "$150", 15050 to "$150.50". */
export function moneyText(cents: number): string {
  if (!Number.isInteger(cents) || cents < 1) throw new PriceReviewRenderError('The approved amount must be more than zero.');
  const dollars = Math.floor(cents / 100);
  const rest = cents % 100;
  const whole = dollars.toLocaleString('en-US');
  return rest === 0 ? `$${whole}` : `$${whole}.${String(rest).padStart(2, '0')}`;
}

export interface PriceReviewMailInput {
  /** First name of the person it goes to, or null for a plain greeting. */
  firstName: string | null;
  /**
   * The plan name the client already sees (Charter.client_label). Null or blank when the client
   * has no label for the plan: the note then says "your marketing plan". The business name is
   * never used, because it is not the name of a plan.
   */
  planLabel: string | null;
  /** Today. The note refuses to render when the start date is past or too near (terms.ts). */
  now: Date;
  /** Mike's approval record, as stored. Anything missing or malformed refuses the render. */
  approval: unknown;
}

export interface PriceReviewMail {
  subject: string;
  text: string;
}

export function renderPriceReviewMail(input: PriceReviewMailInput): PriceReviewMail {
  const a = input.approval && typeof input.approval === 'object' ? (input.approval as Record<string, unknown>) : null;
  const parsed = a
    ? approvedTermsSchema.safeParse({ new_amount_cents: a.new_amount_cents, period: a.period, effective_on: a.effective_on })
    : null;
  const terms: ApprovedTerms | null = parsed?.success ? parsed.data : null;
  if (!terms) {
    throw new PriceReviewRenderError('No approved amount and start date from Mike. Nothing was rendered.');
  }
  const tooSoon = startDateProblem(terms.effective_on, input.now);
  if (tooSoon) throw new PriceReviewRenderError(`${tooSoon} Nothing was rendered.`);
  const label = (input.planLabel ?? '').replace(/\s+/g, ' ').trim();
  const plan = label ? `the price of ${label}` : 'the price of your marketing plan';
  const when = longDate(terms.effective_on);
  const per = terms.period === 'monthly' ? 'month' : 'year';
  const greeting = input.firstName?.trim() ? `Hello ${input.firstName.trim()},` : 'Hello,';

  const text = [
    greeting,
    `Starting ${when}, ${plan} will be ${moneyText(terms.new_amount_cents)} per ${per}.`,
    'Until then, nothing changes.',
    'If you have a question about this, reply to this email and we will answer it.',
    'Thank you for working with us.',
    'Indelible',
  ].join('\n\n');

  return { subject: `Your Indelible plan: new price from ${when}`, text: `${text}\n` };
}
