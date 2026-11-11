/**
 * Slice 7b: the evidence a learned weight can sit on. Pure.
 * Keys: client:<id>, project:<id>, sop:<id>, type:<review|session|wait|thread|task|step>, and sender:<address> for a thread
 * with no client. Crisis mail, site down rows and the hands row have no type key, so nothing learned can reach them.
 */

import type { HomeSourceKind } from '../types';

export const EVIDENCE_TYPES = ['review', 'session', 'wait', 'thread', 'task', 'step'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

export type EvidenceKind = 'client' | 'project' | 'sop' | 'type' | 'sender';

const KEY_MAX = 200;

/** The type key for an item kind, or null for kinds that never take a weight (crisis, site, hands). */
export function typeOf(kind: HomeSourceKind): EvidenceType | null {
  return (EVIDENCE_TYPES as readonly string[]).includes(kind) ? (kind as EvidenceType) : null;
}

export interface EvidenceInput {
  kind: HomeSourceKind;
  client_id?: string | null;
  project_id?: string | null;
  sop_id?: string | null;
  /** The sender address; used only for a thread with no client. */
  sender?: string | null;
}

/** The evidence keys of one item, in a fixed order. [] for a kind that never takes a weight. */
export function evidenceKeys(i: EvidenceInput): string[] {
  const type = typeOf(i.kind);
  if (!type) return [];
  const keys: string[] = [];
  if (i.client_id) keys.push(`client:${i.client_id}`);
  if (i.project_id) keys.push(`project:${i.project_id}`);
  if (i.sop_id) keys.push(`sop:${i.sop_id}`);
  keys.push(`type:${type}`);
  if (i.kind === 'thread' && !i.client_id && i.sender) {
    const s = i.sender.trim().toLowerCase();
    if (s) keys.push(`sender:${s}`);
  }
  return keys.filter((k) => k.length <= KEY_MAX);
}

export function evidenceKindOf(key: string): EvidenceKind | null {
  const head = key.split(':', 1)[0];
  return head === 'client' || head === 'project' || head === 'sop' || head === 'type' || head === 'sender' ? head : null;
}

/** The words for a piece of evidence, as stored in the weight row's label. */
export function evidenceLabel(kind: EvidenceKind, name: string | null | undefined): string {
  const n = (name ?? '').trim();
  switch (kind) {
    case 'client':
      return n || 'this client';
    case 'project':
      return `the ${n || 'unnamed'} project`;
    case 'sop':
      return `tasks that follow ${n || 'a written process'}`;
    case 'sender':
      return `mail from ${n}`;
    case 'type':
      return n;
  }
}

export const TYPE_LABEL: Record<EvidenceType, string> = {
  review: 'sign-offs',
  session: 'session questions',
  wait: 'waits',
  thread: 'email threads',
  task: 'tasks',
  step: 'project next steps',
};

export function typeLabel(key: string): string | null {
  const t = key.startsWith('type:') ? key.slice(5) : '';
  return (EVIDENCE_TYPES as readonly string[]).includes(t) ? TYPE_LABEL[t as EvidenceType] : null;
}
