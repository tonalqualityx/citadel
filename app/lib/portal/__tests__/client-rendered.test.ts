import { describe, it, expect } from 'vitest';
import {
  CLIENT_RENDERED_TASK_FIELDS,
  CLIENT_ROUTING_FIELDS,
  CLIENT_TEXT_FIELDS,
  PORTAL_RENDERED_TAGS,
  isShownInPortal,
  portalTagsChanged,
  renderedFieldsTouched,
} from '../client-rendered';
import { AWAITING_CLARIFICATION_TAG } from '../project-view';
import { CLIENT_APPROVED_TAG, SEND_BACK_TAG } from '@/lib/services/portal';
import { CLIENT_CANCELLED_TAG } from '../status-labels';
import { PLAN_TAG } from '../retainer';
import { formatTaskForClient } from '@/lib/api/client-projections';

describe('the list of task fields a client reads', () => {
  it('pins each portal tag to the constant it mirrors', () => {
    for (const t of [AWAITING_CLARIFICATION_TAG, CLIENT_APPROVED_TAG, SEND_BACK_TAG, CLIENT_CANCELLED_TAG, PLAN_TAG]) expect(PORTAL_RENDERED_TAGS, t).toContain(t);
  });

  it('covers every field the client projection copies out of a task', () => {
    const task = { id: 'i', title: 't', description: 'd', status: 's', comments: [], created_at: 'c', updated_at: 'u' };
    for (const k of Object.keys(formatTaskForClient(task))) {
      if (['id', 'comments', 'created_at', 'updated_at'].includes(k)) continue;
      expect(Object.keys(CLIENT_RENDERED_TASK_FIELDS), k).toContain(k);
    }
  });

  it('names the free-text fields and the routing fields', () => {
    expect([...CLIENT_TEXT_FIELDS].sort()).toEqual(['client_title', 'description', 'requirements', 'title']);
    expect([...CLIENT_ROUTING_FIELDS].sort()).toEqual(['client_id', 'phase_id', 'project_id', 'site_id']);
  });

  it('a Triage card is never shown; every portal visibility rule counts as shown', () => {
    expect(isShownInPortal({ status: 'triage', client_visible: true })).toBe(false);
    expect(isShownInPortal({ status: 'not_started', requested_by_contact_id: 'c' })).toBe(true);
    expect(isShownInPortal({ status: 'in_progress', client_visible: true })).toBe(true);
    expect(isShownInPortal({ status: 'review', staging_preview_url: 'https://p.test', approved: false })).toBe(true);
    expect(isShownInPortal({ status: 'done', client_approved_at: '2026-10-01T00:00:00Z' })).toBe(true);
    expect(isShownInPortal({ status: 'not_started' })).toBe(false);
    expect(isShownInPortal({ status: 'done', staging_preview_url: 'https://p.test' })).toBe(false); // finished work with a leftover preview is not staged
  });

  it('touches: text and routing always, state only for a strict lane, tags only the portal ones', () => {
    expect(renderedFieldsTouched(['title', 'description', 'requirements', 'client_title'], null)).toEqual(['title', 'description', 'requirements', 'client_title']);
    expect(renderedFieldsTouched(['client_id', 'project_id', 'site_id'], null)).toEqual(['client_id', 'project_id', 'site_id']);
    expect(renderedFieldsTouched(['status', 'approved'], null)).toEqual([]);
    expect(renderedFieldsTouched(['status', 'approved'], null, { strict: true })).toEqual(['status', 'approved']);
    expect(renderedFieldsTouched(['due_date', 'assignee_id', 'notes', 'priority'], null, { strict: true })).toEqual([]);
    expect(renderedFieldsTouched(['tags'], { before: ['a'], after: ['a', 'b'] })).toEqual([]);
    expect(renderedFieldsTouched(['tags'], { before: ['a'], after: ['a', 'awaiting-clarification'] })).toEqual(['tags']);
    expect(portalTagsChanged(['client-approved'], [])).toEqual(['client-approved']);
  });
});
