import { describe, it, expect } from 'vitest';
import { bookLine, bookWhen, bookedLine, cleanBookName, BOOK_COPY } from '../book-copy';
import { actionsFor } from '../../actions-for';

const TZ = 'America/New_York';
const at = (day: number, h: number, mi = 0) => new Date(Date.UTC(2026, 10, day, h + 5, mi));

describe('book copy', () => {
  it('says the weekday and the clock in his zone', () => {
    expect(bookWhen(at(12, 14, 0), TZ)).toBe('Thursday at 2:00');
    expect(bookLine('Jessica', at(12, 14, 0), TZ)).toBe('Put 30 minutes on your calendar Thursday at 2:00 to answer Jessica.');
    expect(bookedLine(at(12, 10, 45), TZ)).toBe('Booked Thursday at 10:45');
  });

  it('every sentence is plain: no dash, none of the banned words', () => {
    const all = [...Object.values(BOOK_COPY), bookLine('Jessica', at(12, 14), TZ), bookedLine(at(12, 14), TZ)].join(' ');
    expect(all).not.toMatch(/[–—]/);
    expect(all).not.toMatch(/priority|priorities|overdue/i);
  });

  it('cleans a name to one plain line of at most 80 characters', () => {
    expect(cleanBookName('  Dana \n Whitfield ', 'd@x.test')).toBe('Dana Whitfield');
    expect(cleanBookName('', 'dana@x.test')).toBe('dana');
    expect(cleanBookName('A'.repeat(200), 'a@x.test')).toHaveLength(80);
    expect(cleanBookName('Jo—Ann', 'a@x.test')).toBe('Jo-Ann');
  });
});

describe('Book 30 minutes button', () => {
  const base = { kind: 'thread' as const, parkCount: 0, threadUrl: 'https://mail.example/t' };
  const ids = (r: ReturnType<typeof actionsFor>) => [...r.actions, ...r.more_actions].map((a) => a.id);
  it('is under More on a needs-thought row only when the switch put it there', () => {
    const on = actionsFor({ ...base, owedThread: { state: 'needs_thought', suggestion: true, book: true } } as never);
    expect(on.more_actions.map((a) => a.id)).toContain('book_block');
    expect(ids(actionsFor({ ...base, owedThread: { state: 'needs_thought', suggestion: true } } as never))).not.toContain('book_block');
    expect(ids(actionsFor({ ...base, owedThread: { state: 'draft_ready', suggestion: false, book: true } } as never))).not.toContain('book_block');
  });
});

import { readFileSync } from 'fs';
import { join } from 'path';

describe('Book 30 minutes writes only his owed row', () => {
  it('no write to an email ask, task, outbox or calendar event, and no attendee or send in the booking code', () => {
    for (const f of ['book.ts', 'book-store.ts', 'book-copy.ts', 'slot.ts']) {
      const src = readFileSync(join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(src).not.toMatch(/\b(emailAsk|task|emailOutbox|calendarEvent)\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\b/);
      expect(src).not.toMatch(/attendees|with-meet|queueInOutbox|send-updates/i);
    }
  });
});
