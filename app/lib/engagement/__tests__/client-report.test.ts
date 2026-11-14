import { describe, it, expect } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { createClientReportDraft, gmailComposeUrl, reportTaskDescription, REPORT_BODY_MAX, REPORT_SUBJECT_MAX } from '../client-report';

const pass = { id: 'p', brief_id: 'b', kind: 'client', finished_at: null, lane: 'dox', actions: [] };
// Refusals on the text come before any database call, so no database is needed.
const db = {} as unknown as PrismaClient;
const good = { to: ['jane@client.com'], subject: 'Your Friday update', body: 'We finished the home page this week.' };
const refusal = async (draft: unknown) => createClientReportDraft(db, pass, draft).then(() => null, (e: { statusCode?: number; status?: number; code?: string }) => e);

describe('gmailComposeUrl', () => {
  it('encodes the recipient, subject and body for Mike\'s own account', () => {
    const u = new URL(gmailComposeUrl({ to: ['a@b.com', 'c@d.com'], subject: 'A & B', body: 'Line one\nLine two: 100% done?' }));
    expect(u.origin + u.pathname).toBe('https://mail.google.com/mail/');
    expect(u.searchParams.get('authuser')).toBe('mike@becomeindelible.com');
    expect(u.searchParams.get('view')).toBe('cm');
    expect(u.searchParams.get('to')).toBe('a@b.com,c@d.com');
    expect(u.searchParams.get('su')).toBe('A & B');
    expect(u.searchParams.get('body')).toBe('Line one\nLine two: 100% done?');
  });
});

describe('reportTaskDescription', () => {
  it('leads with the Gmail draft link when there is one', () => {
    const d = reportTaskDescription({ ...good, gmail_draft_id: 'r1', gmail_draft_url: 'https://mail.google.com/mail/u/0/#drafts/abc' });
    expect(d.startsWith('Open the Gmail draft: https://mail.google.com/mail/u/0/#drafts/abc')).toBe(true);
    expect(d).toContain('To: jane@client.com');
    expect(d).toContain('Subject: Your Friday update');
    expect(d).toContain(good.body);
  });
  it('falls back to the compose link and says the draft could not be made', () => {
    const d = reportTaskDescription(good);
    expect(d).toMatch(/^Gmail draft could not be made; the text is below\./);
    expect(d).toContain('https://mail.google.com/mail/?view=cm');
  });
  it('says when there is no recipient on file', () => {
    expect(reportTaskDescription({ ...good, to: [] })).toContain('no recipient on file');
  });
});

describe('createClientReportDraft text checks', () => {
  it('refuses money words with 422 report_money', async () => {
    for (const t of ['The price is settled', 'That is $500', 'a quote for the next phase', '5k extra']) {
      const e = await refusal({ ...good, body: t });
      expect(e?.code, t).toBe('report_money');
      expect(e?.statusCode ?? e?.status).toBe(422);
    }
    expect((await refusal({ ...good, subject: 'Invoice update' }))?.code).toBe('report_money');
  });
  it('refuses an em dash and an en dash with 422 report_dash', async () => {
    for (const ch of ['—', '–']) {
      const e = await refusal({ ...good, body: `Done ${ch} on time` });
      expect(e?.code).toBe('report_dash');
      expect(e?.statusCode ?? e?.status).toBe(422);
    }
  });
  it('holds the length caps (a schema error, not a draft)', async () => {
    expect(await refusal({ ...good, subject: 'x'.repeat(REPORT_SUBJECT_MAX + 1) })).not.toBeNull();
    expect(await refusal({ ...good, body: 'x'.repeat(REPORT_BODY_MAX + 1) })).not.toBeNull();
  });
  it('refuses a Gmail link that is not Gmail', async () => {
    expect(await refusal({ ...good, gmail_draft_url: 'https://evil.example/x' })).not.toBeNull();
  });
  it('refuses a pass that is not an open client pass', async () => {
    const e = await createClientReportDraft(db, { ...pass, kind: 'sweep' }, good).then(() => null, (x) => x);
    expect(e?.code).toBe('client_report_pass');
    const f = await createClientReportDraft(db, { ...pass, lane: 'bast-chat' }, good).then(() => null, (x) => x);
    expect(f?.code).toBe('client_report_pass');
  });
});
