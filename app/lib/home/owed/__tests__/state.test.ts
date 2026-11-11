import { describe, it, expect } from 'vitest';
import { drafterFresh, hasBastDraft, ifIgnoredLine, owedSecondLine, owedStatus } from '../state';
import { NOW, d, makeAsk, makeThread } from '../../__tests__/fixtures/tonight';
import { makeRow } from './fixtures/owed-row';

const fresh = new Date(NOW.getTime() - 30 * 60_000);
const stale = new Date(NOW.getTime() - 3 * 3_600_000);

describe('owedStatus', () => {
  it('no row and no draft says nothing', () => {
    expect(owedStatus(makeThread(), null, NOW)).toBeNull();
    expect(owedStatus(makeThread(), makeRow(), NOW)).toBeNull();
    expect(owedStatus(makeThread(), makeRow({ state: 'failed', attempts: 1 }), NOW)).toBeNull();
  });
  it('a waiting tap is drafting, even over needs_thought', () => {
    expect(owedStatus(makeThread(), makeRow({ request_kind: 'draft' }), NOW)).toBe('drafting');
    expect(owedStatus(makeThread(), makeRow({ state: 'needs_thought', request_kind: 'go_with_that' }), NOW)).toBe('drafting');
  });
  it('needs_thought', () => {
    expect(owedStatus(makeThread(), makeRow({ state: 'needs_thought' }), NOW)).toBe('needs_thought');
  });
  it('Bast draft covering the newest ask is ready', () => {
    const t = makeThread();
    expect(owedStatus(t, makeRow({ state: 'drafted', draft_id: 'r1', draft_for_ask_id: t.asks[0].id }), NOW)).toBe('draft_ready');
  });
  it('Bast draft for an older ask is stale until he edits it', () => {
    const t = makeThread();
    expect(owedStatus(t, makeRow({ state: 'drafted', draft_id: 'r1', draft_for_ask_id: 'older' }), NOW)).toBe('stale_draft');
  });
  it('after his edit: his draft, and older once a newer message arrives', () => {
    const edited = d('2026-11-06T12:00:00Z');
    const early = makeThread({ received_at: d('2026-11-05T15:00:00Z') });
    const late = makeThread({ received_at: d('2026-11-07T15:00:00Z') });
    const row = makeRow({ state: 'drafted', draft_id: 'r1', draft_for_ask_id: 'x', mike_edited_at: edited });
    expect(owedStatus(early, row, NOW)).toBe('his_draft');
    expect(owedStatus(late, row, NOW)).toBe('his_draft_older');
  });
  it('his own draft_url: his draft, or older when their message came after', () => {
    const started = d('2026-11-06T12:00:00Z');
    const a = makeThread({ draft_url: 'https://mail.google.com/d', draft_started_at: started, received_at: d('2026-11-05T15:00:00Z') });
    expect(owedStatus(a, null, NOW)).toBe('his_draft');
    const b = makeThread({ draft_url: 'https://mail.google.com/d', draft_started_at: started, received_at: d('2026-11-08T15:00:00Z') });
    expect(owedStatus(b, null, NOW)).toBe('his_draft_older');
  });
  it('his draft with an unknown start time is his draft', () => {
    expect(owedStatus(makeThread({ draft_url: 'https://mail.google.com/d' }), null, NOW)).toBe('his_draft');
  });
  it('uses the first ask as newest', () => {
    const newer = makeAsk({ received_at: d('2026-11-08T10:00:00Z') });
    const older = makeAsk({ received_at: d('2026-11-01T10:00:00Z'), thread_id: newer.thread_id, account: newer.account });
    expect(owedStatus({ account: newer.account, thread_id: newer.thread_id!, asks: [newer, older] }, makeRow({ draft_id: 'r', draft_for_ask_id: newer.id }), NOW)).toBe('draft_ready');
  });
});

describe('second line words', () => {
  it('maps each state', () => {
    expect(owedSecondLine('draft_ready')).toBe('Draft ready');
    expect(owedSecondLine('drafting')).toBe('Bast is drafting');
    expect(owedSecondLine('stale_draft')).toBe('Bast is drafting');
    expect(owedSecondLine('his_draft')).toBe('You started a draft');
    expect(owedSecondLine('his_draft_older')).toBe('You started a draft');
    expect(owedSecondLine('needs_thought')).toBe('Needs thought');
    expect(owedSecondLine(null)).toBeNull();
  });
});

describe('drafterFresh and the honesty rule', () => {
  it('fresh means a run finished within 2 hours', () => {
    expect(drafterFresh(fresh, NOW)).toBe(true);
    expect(drafterFresh(stale, NOW)).toBe(false);
    expect(drafterFresh(null, NOW)).toBe(false);
    expect(drafterFresh(new Date(NOW.getTime() + 60_000), NOW)).toBe(false);
  });
  it('"within the hour" only when fresh', () => {
    expect(ifIgnoredLine(null, fresh, NOW)).toBe('Bast drafts a reply into your Gmail within the hour. Nothing is sent.');
    expect(ifIgnoredLine(null, stale, NOW)).toBe('Stays here. Nothing is sent.');
    expect(ifIgnoredLine(null, null, NOW)).toBe('Stays here. Nothing is sent.');
    expect(ifIgnoredLine('drafting', stale, NOW)).toBe('Stays here. Nothing is sent.');
    expect(ifIgnoredLine('stale_draft', stale, NOW)).not.toMatch(/within the hour/);
    expect(ifIgnoredLine('stale_draft', fresh, NOW)).toMatch(/within the hour/);
  });
  it('the other states do not depend on the drafter', () => {
    for (const f of [fresh, stale, null]) {
      expect(ifIgnoredLine('draft_ready', f, NOW)).toBe('The draft waits in your Gmail. Nothing is sent until you send it.');
      expect(ifIgnoredLine('needs_thought', f, NOW)).toBe("Stays here with Bast's read. Nothing is sent.");
      expect(ifIgnoredLine('his_draft', f, NOW)).toBe('Your draft waits in Gmail. Nothing is sent.');
      expect(ifIgnoredLine('his_draft_older', f, NOW)).toBe('Your draft waits in Gmail. Nothing is sent.');
    }
  });
  it('hasBastDraft', () => {
    expect(hasBastDraft(makeRow({ draft_id: 'x' }))).toBe(true);
    expect(hasBastDraft(makeRow())).toBe(false);
    expect(hasBastDraft(null)).toBe(false);
  });
});
