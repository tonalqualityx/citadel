import { describe, it, expect } from 'vitest';
import {
  clientVisibleTaskWhere,
  clientHistoryTaskWhere,
  isClientHistoryTask,
  stagedTaskWhere,
  isClientVisibleTask,
  isStagedForApproval,
} from '../visibility';

type Row = {
  requested_by_contact_id: string | null;
  client_visible: boolean;
  staging_preview_url: string | null;
  status: string;
  approved: boolean;
};

// Minimal evaluator for the exact Prisma operators the fragments use, so the where-fragment
// logic is executed against rows instead of compared to its own output.
function matches(row: Record<string, unknown>, where: Record<string, any>): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as any[]).some((w) => matches(row, w));
    if (key === 'AND') return (cond as any[]).every((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, cond);
    const v = row[key];
    if (cond !== null && typeof cond === 'object') {
      if ('not' in cond) return v !== cond.not;
      if ('in' in cond) return (cond.in as unknown[]).includes(v);
      throw new Error(`unsupported operator for ${key}`);
    }
    return v === cond;
  });
}

describe('portal task visibility', () => {
  it('stagedTaskWhere() is exactly the staged rule', () => {
    expect(stagedTaskWhere()).toEqual({
      staging_preview_url: { not: null },
      NOT: { staging_preview_url: '' },
      status: { in: ['review', 'done'] },
      approved: false,
    });
  });

  it('clientVisibleTaskWhere() is requested-by-contact OR client_visible OR staged', () => {
    expect(clientVisibleTaskWhere()).toEqual({
      OR: [{ requested_by_contact_id: { not: null } }, { client_visible: true }, stagedTaskWhere()],
    });
  });

  it('the where-fragments and the predicates agree on every combination', () => {
    const rows: Row[] = [];
    for (const requested_by_contact_id of [null, 'c1'])
     for (const client_visible of [false, true])
      for (const staging_preview_url of [null, '', 'https://s.example'])
        for (const status of ['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'])
          for (const approved of [false, true])
            rows.push({ requested_by_contact_id, client_visible, staging_preview_url, status, approved });

    let staged = 0;
    for (const row of rows) {
      expect(matches(row, stagedTaskWhere())).toBe(isStagedForApproval(row));
      expect(matches(row, clientVisibleTaskWhere())).toBe(isClientVisibleTask(row));
      if (isStagedForApproval(row)) staged++;
    }
    // review/done x one real url x not approved x 2 requesters x 2 client_visible
    expect(staged).toBe(8);
  });

  it('a staged, published task with no requester stays in history but never pending or actionable', () => {
    const published = {
      requested_by_contact_id: null,
      staging_preview_url: 'https://s.example',
      status: 'done',
      approved: true,
      client_approved_at: new Date('2026-10-01'),
    };
    expect(matches(published, clientHistoryTaskWhere())).toBe(true);
    expect(isClientHistoryTask(published)).toBe(true);
    // Strict rules (pending lists, approve, request-changes) still reject it.
    expect(matches(published, stagedTaskWhere())).toBe(false);
    expect(isStagedForApproval(published)).toBe(false);
    expect(matches(published, clientVisibleTaskWhere())).toBe(false);
  });

  it('history does not admit an internal, unapproved task', () => {
    const internal = { requested_by_contact_id: null, staging_preview_url: null, status: 'done', approved: true, client_approved_at: null };
    expect(matches(internal, clientHistoryTaskWhere())).toBe(false);
    expect(isClientHistoryTask(internal)).toBe(false);
  });

  it('hides an internal task (no requesting contact, nothing staged)', () => {
    expect(
      isClientVisibleTask({ requested_by_contact_id: null, staging_preview_url: null, status: 'in_progress', approved: false })
    ).toBe(false);
  });

  it('shows a contact-requested task even when not staged', () => {
    const t = { requested_by_contact_id: 'c1', staging_preview_url: null, status: 'not_started', approved: false };
    expect(isClientVisibleTask(t)).toBe(true);
    expect(isStagedForApproval(t)).toBe(false);
  });

  it('client_visible shares a task in lists but does not make it staged (not pending, not actionable)', () => {
    const t = { requested_by_contact_id: null, client_visible: true, staging_preview_url: null, status: 'in_progress', approved: false };
    expect(isClientVisibleTask(t)).toBe(true);
    expect(isStagedForApproval(t)).toBe(false);
    expect(matches(t, clientVisibleTaskWhere())).toBe(true);
    expect(matches(t, stagedTaskWhere())).toBe(false);
  });

  it('already-published work (approved) is never staged', () => {
    expect(isStagedForApproval({ staging_preview_url: 'https://s.example', status: 'done', approved: true })).toBe(false);
  });
});
