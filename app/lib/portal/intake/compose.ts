/**
 * Compose the Citadel task for a portal request (portal phase B slice 1, spec section 2.4).
 * Pure: takes the validated answers and the placement, returns the fields to write. The
 * transaction, locking and waits live in file-request.ts.
 */
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { MIKE_USER_ID } from '@/lib/waits/owner';
import { KIND_TAGS, TYPE_LABELS, type IntakeType, type StoredAnswer } from './tree';
import type { PlacementResult } from './placement';

export const TITLE_MAX = 80;

/** "{Type label}: {Q1}", whitespace collapsed, cut at a word so the whole title fits 80 characters. */
export function composeTitle(type: IntakeType, q1: string): string {
  const full = `${TYPE_LABELS[type]}: ${q1.replace(/\s+/g, ' ').trim()}`;
  if (full.length <= TITLE_MAX) return full;
  const room = TITLE_MAX - 1; // one character for the ellipsis
  const cut = full.slice(0, room + 1);
  const lastSpace = cut.lastIndexOf(' ');
  // Never cut inside the "{label}:" prefix, and never leave nothing after it.
  const prefixEnd = TYPE_LABELS[type].length + 1;
  const at = lastSpace > prefixEnd ? lastSpace : room;
  return `${full.slice(0, at).replace(/[\s,.;:!?-]+$/, '')}…`;
}

export interface ComposeInput {
  type: IntakeType;
  intake_id: string;
  contact_name: string;
  contact_id: string;
  answers: StoredAnswer[];
  placement: PlacementResult;
  client_id: string;
  /** The chosen site, with what composing needs to know about it. */
  site: {
    id: string;
    is_wordpress: boolean;
    maintenance_assignee_id: string | null;
  } | null;
  /** The two urgent "broken" choices, and the daily emergency limit not yet reached. */
  urgent: boolean;
  emergency_effects: boolean;
  suggested_type?: string | null;
}

export interface ComposedTask {
  title: string;
  client_title: string;
  description_markdown: string;
  priority: number;
  tags: string[];
  assignee_id: string;
  client_id: string;
  site_id: string | null;
  project_id: string | null;
  charter_id: string | null;
  is_retainer_work: boolean;
  is_support: boolean;
  is_billable: false;
  source: 'portal';
  source_ref: string;
  requested_by_contact_id: string;
  status: 'not_started';
  needs_review: false;
  promised_to: null;
  client_intake: Record<string, unknown>;
}

export function sourceRefFor(intakeId: string): string {
  return `portal-intake:${intakeId}`;
}

export function composeDescription(contactName: string, answers: StoredAnswer[]): string {
  const lines = [`Requested in the portal by ${contactName}.`];
  for (const a of answers) {
    lines.push('', `**${a.prompt}**`, '', a.value);
  }
  return lines.join('\n');
}

export function composeTask(input: ComposeInput): ComposedTask {
  const { type, placement } = input;
  const q1 = input.answers.find((a) => a.key === 'q1')?.value ?? '';
  const title = composeTitle(type, q1);

  const tags = ['portal-chat', KIND_TAGS[type]];
  if (placement.quote) tags.push('quote', 'needs-mike');
  if (input.urgent && input.emergency_effects) tags.push('emergency', 'needs-mike');
  // Past the daily emergency limit the request files as priority 2 and still reaches Mike.
  if (input.urgent && !input.emergency_effects) tags.push('needs-mike');
  if (placement.needs_mike) tags.push('needs-mike');
  if (input.suggested_type) tags.push(`suggested:${input.suggested_type}`);

  let priority = 3;
  if (type === 'broken') priority = input.urgent && input.emergency_effects ? 1 : 2;

  // Bast by default; a person only where a WordPress site names its maintainer; Mike owns
  // a marketing question that has nowhere else to go.
  let assignee = BAST_USER_ID;
  if (input.site?.is_wordpress && input.site.maintenance_assignee_id) assignee = input.site.maintenance_assignee_id;
  if (placement.owner_mike) assignee = MIKE_USER_ID;

  return {
    title,
    client_title: title,
    description_markdown: composeDescription(input.contact_name, input.answers),
    priority,
    tags: [...new Set(tags)],
    assignee_id: assignee,
    client_id: input.client_id,
    site_id: placement.site_id,
    project_id: placement.project_id,
    charter_id: placement.charter_id,
    is_retainer_work: placement.chain === 'charter',
    is_support: placement.is_support,
    is_billable: false,
    source: 'portal',
    source_ref: sourceRefFor(input.intake_id),
    requested_by_contact_id: input.contact_id,
    status: 'not_started',
    needs_review: false,
    promised_to: null,
    client_intake: {
      v: 1,
      intake_id: input.intake_id,
      type,
      site_id: placement.site_id,
      project_id: placement.project_id,
      charter_id: placement.charter_id,
      answers: input.answers,
      placement: { chain: placement.chain, rule: placement.rule },
      urgent: input.urgent,
      suggested_type: input.suggested_type ?? null,
    },
  };
}
