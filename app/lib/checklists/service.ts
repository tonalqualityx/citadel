/**
 * Checklist service (specs/citadel-shape-SPEC.md 3.12). Create a checklist from a template, set an
 * item's state with evidence and a verifier, and decide when the checklist is done.
 *
 * Stored `required` is true for before_work and before_launch items. The gate is not a column; the
 * service reads it from the template by key. The checklist is DONE when every required item whose
 * gate is before_work is verified, received, waived or not_applicable. A before_launch item does
 * not hold the checklist open; the launch gate reads it separately. A required item with a key the
 * templates do not know counts as before_work (strict by default).
 *
 * Offboarding never deletes: nothing here deletes a row.
 */
import type { ChecklistKind, Prisma, PrismaClient } from '@prisma/client';
import { findTemplateItem, getChecklistTemplate, type ChecklistTemplate } from './templates';

export const ITEM_STATES = ['missing', 'received', 'verified', 'waived', 'not_applicable'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
const SATISFIED: readonly string[] = ['verified', 'received', 'waived', 'not_applicable'];
/** States that need a note or proof behind them. */
const NEEDS_EVIDENCE: readonly ItemState[] = ['verified', 'waived'];

export interface ItemLike {
  key: string;
  required: boolean;
  state: string;
}

export const isSatisfied = (state: string) => SATISFIED.includes(state);

/** Whether an item must be satisfied before work starts. */
export function isBeforeWork(item: Pick<ItemLike, 'key' | 'required'>): boolean {
  if (!item.required) return false;
  const t = findTemplateItem(item.key);
  return t ? t.gate === 'before_work' : true;
}

/** Items still holding the checklist open. */
export function blockingItems<T extends ItemLike>(items: T[]): T[] {
  return items.filter((i) => isBeforeWork(i) && !isSatisfied(i.state));
}

export function isChecklistDone(items: ItemLike[]): boolean {
  return items.length > 0 && blockingItems(items).length === 0;
}

export class ChecklistError extends Error {
  constructor(
    message: string,
    public code: 'unknown_template' | 'wrong_kind' | 'client_not_found' | 'not_found' | 'item_not_found' | 'bad_state' | 'evidence_required'
  ) {
    super(message);
  }
}

export interface ItemSeed {
  key: string;
  label: string;
  group: string;
  required: boolean;
}

/** Item rows for a template. Pure. */
export function itemsFromTemplate(t: ChecklistTemplate): ItemSeed[] {
  return t.items.map((i) => ({ key: i.key, label: i.label, group: i.group, required: i.gate !== 'none' }));
}

export interface CreateInput {
  kind: ChecklistKind;
  client_id: string;
  template: string;
  accord_id?: string | null;
  charter_id?: string | null;
  project_id?: string | null;
}

const WITH_ITEMS = { items: { orderBy: { key: 'asc' as const } } } satisfies Prisma.ChecklistInclude;

/**
 * Create a checklist from a template. Idempotent: an open checklist of the same kind for the same
 * client and links is returned instead of a second one.
 */
export async function createChecklistFromTemplate(db: PrismaClient, input: CreateInput) {
  const t = getChecklistTemplate(input.template);
  if (!t) throw new ChecklistError(`Unknown template ${input.template}`, 'unknown_template');
  if (t.kind !== input.kind) throw new ChecklistError(`Template ${t.key} is for ${t.kind}, not ${input.kind}`, 'wrong_kind');
  const client = await db.client.findFirst({ where: { id: input.client_id, is_deleted: false }, select: { id: true } });
  if (!client) throw new ChecklistError('Client not found', 'client_not_found');

  const links = {
    accord_id: input.accord_id ?? null,
    charter_id: input.charter_id ?? null,
    project_id: input.project_id ?? null,
  };
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'checklist-create:' + input.client_id + ':' + input.kind}))`;
    const open = await tx.checklist.findFirst({
      where: { kind: input.kind, client_id: input.client_id, done_at: null, ...links },
      include: WITH_ITEMS,
    });
    if (open) return { checklist: open, created: false };
    const created = await tx.checklist.create({
      data: { kind: input.kind, client_id: input.client_id, ...links, items: { create: itemsFromTemplate(t) } },
      include: WITH_ITEMS,
    });
    return { checklist: created, created: true };
  });
}

export interface SetStateInput {
  state: ItemState;
  evidence?: string | null;
  verified_by_id: string;
  now?: Date;
}

/** Set one item's state. Verified and waived need evidence. Recomputes the checklist's done_at. */
export async function setItemState(db: PrismaClient, checklistId: string, key: string, input: SetStateInput) {
  if (!(ITEM_STATES as readonly string[]).includes(input.state)) throw new ChecklistError('Unknown state', 'bad_state');
  const evidence = input.evidence?.trim() ? input.evidence.trim() : null;
  if (NEEDS_EVIDENCE.includes(input.state) && !evidence) {
    throw new ChecklistError(`State ${input.state} needs evidence: a note, link or reason`, 'evidence_required');
  }
  const now = input.now ?? new Date();
  return db.$transaction(async (tx) => {
    const item = await tx.checklistItem.findUnique({ where: { checklist_id_key: { checklist_id: checklistId, key } } });
    if (!item) {
      const exists = await tx.checklist.findUnique({ where: { id: checklistId }, select: { id: true } });
      throw new ChecklistError(exists ? 'Item not found' : 'Checklist not found', exists ? 'item_not_found' : 'not_found');
    }
    const verifying = input.state !== 'missing' && input.state !== 'received';
    await tx.checklistItem.update({
      where: { id: item.id },
      data: {
        state: input.state,
        // Keep earlier evidence when none is sent; a reset to missing clears the verifier.
        evidence: evidence ?? (input.state === 'missing' ? null : item.evidence),
        verified_by_id: verifying ? input.verified_by_id : null,
        verified_at: verifying ? now : null,
      },
    });
    const [all, current] = await Promise.all([
      tx.checklistItem.findMany({ where: { checklist_id: checklistId } }),
      tx.checklist.findUnique({ where: { id: checklistId }, select: { done_at: true } }),
    ]);
    // Done stamps once and keeps its first date; a regression back to open clears it.
    const doneAt = isChecklistDone(all) ? current?.done_at ?? now : null;
    const checklist = await tx.checklist.update({ where: { id: checklistId }, data: { done_at: doneAt }, include: WITH_ITEMS });
    return checklist;
  });
}

export function serializeChecklist(c: {
  id: string;
  kind: string;
  client_id: string;
  accord_id: string | null;
  charter_id: string | null;
  project_id: string | null;
  started_at: Date;
  done_at: Date | null;
  items: Array<{
    key: string;
    label: string;
    group: string;
    required: boolean;
    state: string;
    verified_by_id: string | null;
    verified_at: Date | null;
    evidence: string | null;
  }>;
}) {
  const template = findTemplateItem;
  return {
    id: c.id,
    kind: c.kind,
    client_id: c.client_id,
    accord_id: c.accord_id,
    charter_id: c.charter_id,
    project_id: c.project_id,
    started_at: c.started_at,
    done_at: c.done_at,
    done: c.done_at !== null,
    blocking_keys: blockingItems(c.items).map((i) => i.key),
    items: c.items.map((i) => ({
      key: i.key,
      label: i.label,
      client_label: template(i.key)?.client_label ?? null,
      group: i.group,
      required: i.required,
      gate: i.required ? (isBeforeWork(i) ? 'before_work' : 'before_launch') : 'none',
      state: i.state,
      verified_by_id: i.verified_by_id,
      verified_at: i.verified_at,
      evidence: i.evidence,
    })),
  };
}
