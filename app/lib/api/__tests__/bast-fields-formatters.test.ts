import { describe, it, expect } from 'vitest';
import { formatTaskResponse, formatSiteResponse, formatEmailAskResponse } from '../formatters';

describe('formatTaskResponse — Bast triage fields', () => {
  it('surfaces tags, source, provenance, and staging-approval fields', () => {
    const out = formatTaskResponse({
      id: 't1',
      title: 'Update menu',
      status: 'in_progress',
      priority: 3,
      tags: ['bast-doable', 'stack:eleventy', 'kind:content'],
      source: 'email',
      source_ref: '19ed608ce28eedf4',
      requested_by_contact_id: 'c1',
      staging_preview_url: 'https://staging.aldervt.com',
      staging_deployed_at: '2026-06-20T12:00:00Z',
      client_approved_at: null,
      approved_by_contact_id: null,
    });
    expect(out.tags).toEqual(['bast-doable', 'stack:eleventy', 'kind:content']);
    expect(out.source).toBe('email');
    expect(out.source_ref).toBe('19ed608ce28eedf4');
    expect(out.requested_by_contact_id).toBe('c1');
    expect(out.staging_preview_url).toBe('https://staging.aldervt.com');
    expect(out.approved_by_contact_id).toBeNull();
  });

  it('defaults tags to an empty array when absent', () => {
    const out = formatTaskResponse({ id: 't2', title: 'x', status: 'not_started', priority: 3 });
    expect(out.tags).toEqual([]);
  });
});

describe('formatSiteResponse — staging + Bast config', () => {
  it('surfaces staging fields and bast_enabled', () => {
    const out = formatSiteResponse({
      id: 's1',
      name: 'Alder',
      site_type: 'eleventy',
      prod_branch: 'main',
      staging_branch: 'staging',
      staging_url: 'staging.aldervt.com',
      staging_auth_user: 'preview',
      staging_auth_password: 'gate-only',
      bast_enabled: true,
    });
    expect(out.prod_branch).toBe('main');
    expect(out.staging_branch).toBe('staging');
    expect(out.staging_url).toBe('staging.aldervt.com');
    expect(out.staging_auth_user).toBe('preview');
    expect(out.bast_enabled).toBe(true);
  });

  it('defaults bast_enabled to false when absent', () => {
    const out = formatSiteResponse({ id: 's2', name: 'x' });
    expect(out.bast_enabled).toBe(false);
  });
});

describe('formatEmailAskResponse — draft-started marker', () => {
  const base = {
    id: 'a1',
    account: 'mike@becomeindelible.com',
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/msg-1',
  };

  it('passes both fields through untouched', () => {
    const at = new Date('2026-10-14T15:30:00.000Z');
    // Deliberately not the shape normalizeGmailDeepLink would emit.
    const url = 'https://mail.google.com/mail/u/?authuser=whoismikedion%40gmail.com#all/thread-1';
    const out = formatEmailAskResponse({ ...base, draft_started_at: at, draft_url: url });
    expect(out.draft_started_at).toBe(at);
    expect(out.draft_url).toBe(url);
  });

  it('defaults both to null when absent or undefined', () => {
    const out = formatEmailAskResponse({ ...base });
    expect(out.draft_started_at).toBeNull();
    expect(out.draft_url).toBeNull();
  });

  it('does not rewrite draft_url the way deep_link is rewritten', () => {
    const url = 'https://mail.google.com/mail/u/0/#inbox/thread-9';
    const out = formatEmailAskResponse({ ...base, draft_started_at: new Date(), draft_url: url });
    expect(out.draft_url).toBe(url);
    expect(out.deep_link).not.toBe(base.deep_link);
  });
});
