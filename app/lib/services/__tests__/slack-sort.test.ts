import { describe, it, expect } from 'vitest';
import {
  sortSlackNotice,
  keptNoticeParts,
  buildKeptNoticeBlocks,
  buildDigestMessage,
  digestDue,
  type DigestItem,
  waitDigestTitle,
  DIGEST_TITLE_MAX,
} from '../slack-sort';

describe('sortSlackNotice', () => {
  it('stops low priority and anything marked stop', () => {
    expect(sortSlackNotice({ type: 'comment_added', priority: 'low' })).toBe('stop');
    expect(sortSlackNotice({ type: 'task_mentioned', priority: 'high', metadata: { slackSort: 'stop' } })).toBe('stop');
  });

  it('digests ordinary notices and project task assignments', () => {
    expect(sortSlackNotice({ type: 'comment_added', priority: 'normal' })).toBe('digest');
    expect(
      sortSlackNotice({ type: 'task_assigned', priority: 'normal', metadata: { isAdHocOrSupport: false, projectId: 'p1' } })
    ).toBe('digest');
    expect(sortSlackNotice({ type: 'system_alert', priority: 'high', metadata: { slackSort: 'digest' } })).toBe('digest');
  });

  it('keeps ad hoc assignments, high alerts and mentions', () => {
    expect(sortSlackNotice({ type: 'task_assigned', priority: 'normal', metadata: { isAdHocOrSupport: true } })).toBe('keep');
    expect(sortSlackNotice({ type: 'task_assigned', priority: 'normal' })).toBe('keep');
    expect(sortSlackNotice({ type: 'system_alert', priority: 'high' })).toBe('keep');
    expect(sortSlackNotice({ type: 'task_mentioned', priority: 'normal' })).toBe('keep');
  });
});

describe('kept notice', () => {
  const parts = keptNoticeParts({
    type: 'task_assigned',
    title: 'New quest assigned: Fix header',
    context: { title: 'Fix header', projectName: 'Acme site', dueDate: 'Dec 2' },
    link: 'https://app.test/tasks/1',
    appUrl: 'https://app.test',
  });

  it('writes four parts', () => {
    expect(parts.what).toBe('New task for you: Fix header');
    expect(parts.why).toBe('It is assigned to you, due Dec 2 in Acme site.');
    expect(parts.action).toBe('Open the task and start it.');
    expect(parts.link).toBe('https://app.test/tasks/1');
  });

  it('shows all four in the built text and blocks', () => {
    const { text, blocks } = buildKeptNoticeBlocks(parts);
    const section = (blocks[0] as { text: { text: string } }).text.text;
    expect(section).toContain('*New task for you: Fix header*');
    expect(section).toContain('*Why it matters:*');
    expect(section).toContain('*Action:*');
    expect(section).toContain('<https://app.test/tasks/1|Open in Citadel>');
    expect(text).toBe('New task for you: Fix header. Open the task and start it.');
    expect(JSON.stringify(blocks[1])).toContain('https://app.test/tasks/1');
  });

  it('falls back to the dashboard link and honours overrides', () => {
    const p = keptNoticeParts({
      type: 'system_alert',
      title: 'Disk full',
      metadata: { slackWhy: 'Backups fail.', slackAction: 'Free space.' },
      link: null,
      appUrl: 'https://app.test',
    });
    expect(p).toMatchObject({ why: 'Backups fail.', action: 'Free space.', link: 'https://app.test/dashboard' });
  });

  it('throws when a part is empty', () => {
    expect(() => buildKeptNoticeBlocks({ ...parts, why: '' })).toThrow();
    expect(() => buildKeptNoticeBlocks({ ...parts, link: ' ' })).toThrow();
  });
});

describe('buildDigestMessage', () => {
  const item = (n: number, over: Partial<DigestItem> = {}): DigestItem => ({
    notification_type: 'comment_added',
    title: `Item ${n}`,
    link: `https://app.test/${n}`,
    entity_type: 'task',
    created_at: new Date(2026, 0, 1, 8, n),
    ...over,
  });

  it('puts money and deadlines first, then oldest first', () => {
    const { text } = buildDigestMessage(
      [item(1), item(2, { notification_type: 'task_overdue', title: 'Late' }), item(3, { entity_type: 'wait', title: 'Waiting' })],
      { appUrl: 'https://app.test' }
    );
    const lines = text.split('\n');
    expect(lines[0]).toBe('Citadel daily digest: 3 items');
    expect(lines[1]).toContain('Late');
    expect(lines[2]).toContain('Waiting');
    expect(lines[3]).toContain('Item 1');
  });

  it('uses the singular for one item and escapes titles', () => {
    const { text } = buildDigestMessage([item(1, { title: 'A <b> & c', link: null })], { appUrl: 'https://app.test' });
    expect(text).toBe('Citadel daily digest: 1 item\n• A &lt;b&gt; &amp; c');
  });

  it('caps at 10 lines with an and K more line', () => {
    const items = Array.from({ length: 13 }, (_, i) => item(i + 1));
    const lines = buildDigestMessage(items, { appUrl: 'https://app.test' }).text.split('\n');
    expect(lines).toHaveLength(12);
    expect(lines[11]).toBe('and 3 more: <https://app.test/dashboard|open Citadel>');
  });
});

describe('digestDue (9:00 America/New_York)', () => {
  // January is EST (UTC-5), July is EDT (UTC-4).
  it('is not due before 9:00 and is due at 9:00', () => {
    expect(digestDue(new Date('2026-01-15T13:59:00Z'), null)).toBe(false);
    expect(digestDue(new Date('2026-01-15T14:00:00Z'), null)).toBe(true);
    expect(digestDue(new Date('2026-07-15T12:59:00Z'), null)).toBe(false);
    expect(digestDue(new Date('2026-07-15T13:00:00Z'), null)).toBe(true);
  });

  it('is not due again once sent today, and is due when last sent yesterday', () => {
    const now = new Date('2026-01-15T15:00:00Z');
    expect(digestDue(now, new Date('2026-01-15T14:05:00Z'))).toBe(false);
    expect(digestDue(now, new Date('2026-01-14T14:05:00Z'))).toBe(true);
    const julyNow = new Date('2026-07-15T15:00:00Z');
    expect(digestDue(julyNow, new Date('2026-07-15T13:05:00Z'))).toBe(false);
    expect(digestDue(julyNow, new Date('2026-07-14T13:05:00Z'))).toBe(true);
  });

  it('counts a send before 9:00 today as not today\'s digest', () => {
    expect(digestDue(new Date('2026-01-15T15:00:00Z'), new Date('2026-01-15T12:00:00Z'))).toBe(true);
  });
});

describe('waitDigestTitle', () => {
  it('keeps the day count when the wait title is long, and it survives the digest line', () => {
    const title = waitDigestTitle('Approve the homepage copy and the full sitemap for the spring relaunch '.repeat(4), 5);
    expect(title.length).toBeLessThanOrEqual(DIGEST_TITLE_MAX);
    expect(title.endsWith('(waiting 5 days)')).toBe(true);
    const { text } = buildDigestMessage(
      [{ notification_type: 'system_alert', title, link: null, entity_type: 'wait', created_at: new Date() }],
      { appUrl: 'https://citadel.example' }
    );
    expect(text).toContain('(waiting 5 days)');
  });

  it('leaves a short title whole and adds no count when the wait has no start', () => {
    expect(waitDigestTitle('Approve copy', 3)).toBe('A client is blocked on you: Approve copy (waiting 3 days)');
    expect(waitDigestTitle('Approve copy', null)).toBe('A client is blocked on you: Approve copy');
  });
});
