/**
 * Home screen Slice 6c: the automatic outside scan, the pure part.
 *
 * The scan is read-only and runs on the machine. Citadel decides which site is due (selectScans), hands the machine a host
 * taken only from a Site record of an active client, and validates what comes back (scanBodySchema, scanSummaryProblem).
 * Nothing here requests anything. Pure: no I/O, no Prisma.
 */

import { z } from 'zod';
import { isNoiseSite, type SiteHost } from './site';

/** At most this many scans are handed out in one run. */
export const MAX_SCANS_PER_RUN = 2;
/** At most one scan per site in this window. */
export const SCAN_REPEAT_MS = 6 * 60 * 60 * 1000;
/** A site that answered again is scanned only while its incident closed no longer ago than this. */
export const SCAN_AFTER_CLOSE_MS = 30 * 60 * 1000;
/** A request the machine never answered is not accepted any more after this long. */
export const SCAN_ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SCAN_SUMMARY_MAX = 500;
export const SCAN_FINDINGS_MAX_BYTES = 8 * 1024;
export const SCAN_BODY_BYTES = 16 * 1024;
export { SCAN_ACTION, outsideCheckLine, outsideCheckHandledLine } from './copy';

export interface ScanCandidate {
  key: string;
  site_id: string;
  /** Why it is due: a site that answers again, or a security task on that site. */
  reason: 'answers_again' | 'security_task';
  /** Orders the candidates, oldest first. */
  since: Date;
}

export interface ScanPlanInput {
  candidates: readonly ScanCandidate[];
  /** Every Site of an active client, by id. The only place a host comes from. */
  sites: ReadonlyMap<string, SiteHost>;
  /** site id to the most recent time a scan of that site was requested, for any item. */
  lastRequested: ReadonlyMap<string, Date>;
  now: Date;
}

export interface PlannedScan {
  key: string;
  site_id: string;
  host: string;
}

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * The scans to hand out now: a site that answers again first, then security tasks, each group oldest first; one per site;
 * never a site scanned in the last 6 hours, a site of an inactive client (it is not in `sites`) or a noise site; at most 2.
 */
export function selectScans(input: ScanPlanInput): PlannedScan[] {
  const order = { answers_again: 0, security_task: 1 } as const;
  const sorted = [...input.candidates].sort(
    (a, b) => order[a.reason] - order[b.reason] || a.since.getTime() - b.since.getTime() || a.key.localeCompare(b.key)
  );
  const out: PlannedScan[] = [];
  const taken = new Set<string>();
  for (const c of sorted) {
    if (out.length >= MAX_SCANS_PER_RUN) break;
    if (taken.has(c.site_id)) continue;
    const site = input.sites.get(c.site_id);
    if (!site || isNoiseSite(site) || !HOST_RE.test(site.host) || site.host.length > 253) continue;
    const last = input.lastRequested.get(c.site_id);
    if (last && input.now.getTime() - last.getTime() < SCAN_REPEAT_MS) continue;
    taken.add(c.site_id);
    out.push({ key: c.key, site_id: c.site_id, host: site.host });
  }
  return out;
}

// ============================================================================
// What comes back
// ============================================================================

const chars = (...codes: number[]): string => codes.map((c) => String.fromCharCode(c)).join('');
const DASH_RE = new RegExp(`[${chars(0x2014, 0x2013)}]`);
const BREAK_RE = new RegExp(`[${chars(0x00)}-${chars(0x1f)}${chars(0x7f)}-${chars(0x9f)}${chars(0x2028, 0x2029)}]`);
const INVISIBLE_RE = new RegExp(`[${chars(0x200b)}-${chars(0x200f)}${chars(0x202a)}-${chars(0x202e)}${chars(0x2060, 0xfeff)}]`, 'g');
const BANNED_WORD_RE = /\b(?:priority|priorities|overdue)\b/i;
const SCHEME_RE = /[a-z][a-z0-9+.-]*:\/\//i;
const MAIL_OR_PROTOCOL_RE = /\b(?:mailto|tel|javascript|data|file):/i;
const HOST_WITH_PATH_RE = /[a-z0-9-]\.[a-z]{2,}(?::\d+)?[/?#]/i;

/** Why a summary is refused, or null when it passes. Checks the raw text, before any neutralising. */
export function scanSummaryProblem(raw: string): string | null {
  const s = raw.trim();
  if (s === '') return 'The summary is empty.';
  if (s.length > SCAN_SUMMARY_MAX) return `The summary is longer than ${SCAN_SUMMARY_MAX} characters.`;
  if (BREAK_RE.test(s)) return 'The summary must be one paragraph of plain text.';
  if (DASH_RE.test(s)) return 'The summary has an em or en dash.';
  if (BANNED_WORD_RE.test(s)) return 'The summary has a word that never goes on this screen.';
  if (SCHEME_RE.test(s) || MAIL_OR_PROTOCOL_RE.test(s) || HOST_WITH_PATH_RE.test(s) || /\/\//.test(s)) {
    return 'The summary may name a host but never a link.';
  }
  return null;
}

/** Slack and markup characters neutralised, spaces squashed. Run only on a summary that passed scanSummaryProblem. */
export function neutraliseSummary(raw: string): string {
  return raw
    .replace(INVISIBLE_RE, '')
    .replace(/&/g, ' and ')
    .replace(/@/g, ' at ')
    .replace(/[<>]/g, ' ')
    .replace(/[*_~`|\\{}[\]]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export const scanBodySchema = z
  .object({
    key: z.string().min(1).max(300),
    summary: z.string().max(SCAN_SUMMARY_MAX + 200),
    findings: z.record(z.string().max(100), z.unknown()),
  })
  .strict()
  .superRefine((b, ctx) => {
    const problem = scanSummaryProblem(b.summary);
    if (problem) ctx.addIssue({ code: 'custom', path: ['summary'], message: problem });
    let size = Infinity;
    try {
      size = Buffer.byteLength(JSON.stringify(b.findings), 'utf8');
    } catch {
      size = Infinity;
    }
    if (size > SCAN_FINDINGS_MAX_BYTES) {
      ctx.addIssue({ code: 'custom', path: ['findings'], message: `findings must be JSON of at most ${SCAN_FINDINGS_MAX_BYTES} bytes.` });
    }
  });
export type ScanBody = z.infer<typeof scanBodySchema>;
