import { describe, it, expect } from 'vitest';
import {
  clientVisibleTaskWhere,
  stagedTaskWhere,
  isClientVisibleTask,
  isStagedForApproval,
} from '../visibility';

describe('portal task visibility', () => {
  it('hides an internal task (no requesting contact, nothing staged)', () => {
    expect(isClientVisibleTask({ requested_by_contact_id: null, staging_preview_url: null, status: 'in_progress' })).toBe(false);
  });

  it('shows a task a client contact requested, even if not staged', () => {
    const t = { requested_by_contact_id: 'c1', staging_preview_url: null, status: 'not_started' };
    expect(isClientVisibleTask(t)).toBe(true);
    expect(isStagedForApproval(t)).toBe(false);
  });

  it('shows a staged task with no requesting contact', () => {
    const t = { requested_by_contact_id: null, staging_preview_url: 'https://s.example', status: 'review' };
    expect(isClientVisibleTask(t)).toBe(true);
    expect(isStagedForApproval(t)).toBe(true);
  });

  it('treats an empty staging url, or a non-awaiting status, as not staged', () => {
    expect(isStagedForApproval({ staging_preview_url: '', status: 'review' })).toBe(false);
    expect(isStagedForApproval({ staging_preview_url: 'https://s.example', status: 'not_started' })).toBe(false);
    expect(isStagedForApproval({ staging_preview_url: 'https://s.example', status: 'abandoned' })).toBe(false);
  });

  it('where-fragments mirror the predicates', () => {
    expect(clientVisibleTaskWhere()).toEqual({
      OR: [{ requested_by_contact_id: { not: null } }, stagedTaskWhere()],
    });
    expect(stagedTaskWhere()).toMatchObject({
      staging_preview_url: { not: null },
      status: { in: ['review', 'done'] },
    });
  });
});
