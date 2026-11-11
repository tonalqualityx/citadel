// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Home Slice 4b, enforcement point 1: "Send the draft" has ONE door. Same grep method as outbox-single-writer.test.ts.
 *  - the only file that passes kind owed_reply to the outbox is lib/home/owed/send.ts
 *  - the only importer of queueOwedReplySend is app/api/home/send/route.ts
 *  - that route's first statement is `await requireHomeUser()`
 *  - queueInOutbox itself refuses an owed_reply row unless the owner's switch is on (a structural guard, so no other caller can make one)
 */
const ROOT = path.resolve(__dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', '__tests__', 'e2e', 'prisma']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

const files = ['app', 'lib', 'scripts', 'components'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f);
const read = (f: string) => fs.readFileSync(f, 'utf8');

describe('Send the draft has one door', () => {
  // (home_keeper_runs also has a kind called owed_reply, the drafter's run; it is not an outbox kind, so the test looks at who calls queueInOutbox.)
  it('only lib/home/owed/send.ts calls queueInOutbox with kind owed_reply (literal or OWED_REPLY_KIND)', () => {
    const callers = files.filter((f) => /(?<!function )queueInOutbox\(/.test(read(f)) && /owed_reply|OWED_REPLY_KIND/.test(read(f)));
    expect(callers.map(rel)).toEqual(['lib/home/owed/send.ts']);
  });

  it('no file builds an outbox create input of kind owed_reply outside queueInOutbox', () => {
    const hits = files.filter((f) => /emailOutbox\.(create|createMany|upsert)\b/.test(read(f)));
    expect(hits.map(rel)).toEqual(['lib/sends/outbox.ts']);
  });

  it('the only importer of queueOwedReplySend is the send route', () => {
    const importers = files.filter((f) => rel(f) !== 'lib/home/owed/send.ts' && /import[^;]*\bqueueOwedReplySend\b[^;]*from/.test(read(f)));
    expect(importers.map(rel)).toEqual(['app/api/home/send/route.ts']);
  });

  it('the route\'s first statement in POST is await requireHomeUser()', () => {
    const src = read(path.join(ROOT, 'app/api/home/send/route.ts'));
    const m = src.match(/export async function POST\([^)]*\)\s*\{\s*(?:try\s*\{\s*)?([^\n]+)/);
    expect(m).not.toBeNull();
    expect(m![1].trim()).toMatch(/^const auth = await requireHomeUser\(\);$/);
  });

  it('queueOwedReplySend reads the switch before anything else', () => {
    const src = read(path.join(ROOT, 'lib/home/owed/send.ts'));
    const start = src.indexOf('export async function queueOwedReplySend');
    const body = src.slice(start);
    expect(body.indexOf('owedSwitchOn(')).toBeGreaterThan(-1);
    expect(body.indexOf('owedSwitchOn(')).toBeLessThan(body.indexOf('emailAsk.findMany'));
    expect(body.indexOf('owedSwitchOn(')).toBeLessThan(body.indexOf('appendHomeAction('));
  });

  it('queueInOutbox runs the owed guard before the create', () => {
    const src = read(path.join(ROOT, 'lib/sends/outbox.ts'));
    expect(src.indexOf('await assertOwedReplyAllowed(')).toBeGreaterThan(-1);
    expect(src.indexOf('await assertOwedReplyAllowed(')).toBeLessThan(src.search(/emailOutbox\.create\b/));
  });

  it('the home action name is the same on both sides of the door', async () => {
    const a = await import('@/lib/sends/owed-reply');
    const b = await import('@/lib/home/owed/send-copy');
    expect(a.OWED_SEND_ACTION).toBe(b.SEND_ACTION);
  });

  it('homeActSchema cannot reach it, and the chat never imports the send door', () => {
    const chat = files.filter((f) => rel(f).startsWith('lib/bast-chat/') || rel(f).startsWith('app/api/bast-chat/'));
    expect(chat.filter((f) => /owed\/send['"]|queueOwedReplySend|api\/home\/send/.test(read(f))).map(rel)).toEqual([]);
  });
});
