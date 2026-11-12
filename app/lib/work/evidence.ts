/**
 * Work stage D: work_evidence, what a source reported about a piece of work. Written ONLY by code paths (the courier and the send
 * door, receipts, the classifier, calendar sync, the reconciler, the session close pass, the worker ledger), never by a person typing.
 * Each row holds a kind, a ref, a time and one short plain line. No mail text: the line is cut to 300 characters, dashes are
 * replaced, and a row with no target is simply not written.
 *
 * TODO(stage-c): `our_reply` has no writer yet. Stage C's send record (and answered_since) will write it; Stage D reads sends from email_outbox only.
 *
 * Idempotent: dedupe_key is unique, so the same fact reported twice is one row. Nothing here changes a task, a project or a link.
 */

import type { HomeDb } from '@/lib/home/state';
import { displayText } from '@/lib/home/copy';
import { clip, parseTargetKey, targetKeyOf, type WorkKind } from './keys';

export const EVIDENCE_KINDS = ['their_message', 'our_reply', 'send', 'deploy', 'live', 'commit', 'gate', 'delivered_file', 'meeting_held', 'mike_quote', 'bast_run', 'client_approval'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const isEvidenceKind = (v: unknown): v is EvidenceKind => typeof v === 'string' && (EVIDENCE_KINDS as readonly string[]).includes(v);

export const EVIDENCE_BATCH_MAX = 100;

export interface EvidenceItem {
  kind: EvidenceKind;
  ref: string;
  at: Date;
  line: string;
  href?: string | null;
  /** Which code path wrote it: courier, door, receipts, classifier, calendar, reconciler, session, worker, ... */
  source: string;
  /** Where it belongs: a target key, or the source it came from (its active links are the targets). One of the two. */
  target_key?: string | null;
  from?: { kind: WorkKind; ref: string } | null;
}

export interface EvidenceResult {
  written: number;
  duplicates: number;
  /** Items that named no target and whose source is attached nowhere. */
  unattached: number;
}

/** The plain line of a row: dashes out, one line, at most 300 characters. */
export function evidenceLine(line: string): string {
  return clip(displayText(line.replace(/[\r\n]+/g, ' ')), 300);
}

const dedupeKeyOf = (it: EvidenceItem, targetKey: string): string => clip(`${targetKey}|${it.kind}|${it.ref}|${it.at.toISOString()}`, 400);

export async function recordEvidence(db: HomeDb, items: readonly EvidenceItem[]): Promise<EvidenceResult> {
  const out: EvidenceResult = { written: 0, duplicates: 0, unattached: 0 };
  for (const it of items.slice(0, EVIDENCE_BATCH_MAX)) {
    const targets: { key: string; project_id: string | null; task_id: string | null; link_id: string | null }[] = [];
    if (it.target_key) {
      const p = parseTargetKey(it.target_key);
      if (p) {
        // A task's evidence also carries its project, so the project's drawer reads it.
        const tp = p.type === 'task' ? (await db.task.findUnique({ where: { id: p.id }, select: { project_id: true } }))?.project_id ?? null : p.id;
        targets.push({ key: targetKeyOf(p.type, p.id), project_id: tp, task_id: p.type === 'task' ? p.id : null, link_id: null });
      }
    } else if (it.from) {
      const links = await db.workLink.findMany({ where: { kind: it.from.kind, ref: it.from.ref, state: 'active' }, select: { id: true, target_key: true, project_id: true, task_id: true } });
      for (const l of links) targets.push({ key: l.target_key, project_id: l.project_id, task_id: l.task_id, link_id: l.id });
    }
    if (targets.length === 0) {
      out.unattached += 1;
      continue;
    }
    for (const t of targets) {
      const dedupe_key = dedupeKeyOf(it, t.key);
      const r = await db.workEvidence.createMany({
        data: [{
          target_key: t.key,
          project_id: t.project_id,
          task_id: t.task_id,
          link_id: t.link_id,
          kind: it.kind,
          ref: clip(it.ref, 300),
          at: it.at,
          line: evidenceLine(it.line),
          href: it.href ? clip(it.href, 1000) : null,
          source: clip(it.source, 30),
          dedupe_key,
        }],
        skipDuplicates: true,
      });
      if (r.count === 1) out.written += 1;
      else out.duplicates += 1;
    }
  }
  return out;
}

/** The recent evidence of one target (a project also reads the evidence written for its tasks). Newest first. */
export async function loadEvidence(db: HomeDb, targetKey: string, limit = 30) {
  const p = parseTargetKey(targetKey);
  if (!p) return [];
  const where = p.type === 'project' ? { OR: [{ target_key: targetKey }, { project_id: p.id }] } : { target_key: targetKey };
  return db.workEvidence.findMany({ where, orderBy: { at: 'desc' }, take: limit, select: { kind: true, ref: true, at: true, line: true, href: true, source: true, target_key: true } });
}
