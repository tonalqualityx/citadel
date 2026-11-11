// @vitest-environment node
/**
 * Work stage A invariant: every place that sets a task to done or abandoned goes through closeAsksForTask(s). Same grep style as
 * lib/sends/__tests__/outbox-single-writer.test.ts. Two checks:
 *   1. the known writers each call the closure (the list below);
 *   2. no OTHER file writes a task status of done or abandoned (or a status it cannot name) in a task write or an UPDATE tasks.
 * A new writer fails (2) until it calls the closure and is added to REQUIRED, or is named in EXEMPT with the reason it cannot
 * carry an email link.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(__dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', '__tests__', 'e2e', 'prisma']);

/** Files that write done or abandoned on a task, and must call the closure. */
const REQUIRED = [
  'lib/services/task-patch.ts', // the PATCH route, the chat, the reconcile apply, the owner's taps: afterStatusChange
  'lib/portal/go-live.ts', // markLive
  'lib/portal/chat/confirm.ts', // a question chat closed after a day
  'lib/portal/cancel.ts', // the client cancels in the portal (raw UPDATE tasks)
  'lib/home/reconcile/track.ts', // a task created already done from his sent mail
  'lib/home/reconcile/undo.ts', // Undo of "Track it" abandons the tasks it made
  'lib/bast-chat/ops/start-common.ts', // Undo of a started kickoff or pricing task
  'lib/services/maintenance-generator.ts', // a new period abandons the last period's tasks
  'lib/services/charter-generator.ts', // a new period abandons the last period's tasks
  'app/api/tasks/route.ts', // POST /api/tasks may create a task already done or abandoned
];

/** Files that match the scan but carry no email link, with the reason. Empty on purpose. */
const EXEMPT: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

/** The text of each `.task.update|updateMany|create|createMany|upsert(...)` call (balanced parentheses). */
function taskWrites(src: string): string[] {
  const out: string[] = [];
  const re = /\b(?:task|tasks)\.(?:update|updateMany|create|createMany|upsert)\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    let i = re.lastIndex;
    let depth = 1;
    while (i < src.length && depth > 0) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') depth -= 1;
      i += 1;
    }
    out.push(src.slice(m.index, i));
  }
  return out;
}

/** The top-level text of the `data: { ... }` object of a write block ('' when data is not an object literal). */
function dataObject(block: string): string {
  const m = block.match(/\bdata\s*:\s*\{/);
  if (!m || m.index === undefined) return '';
  let i = m.index + m[0].length;
  let depth = 1;
  let top = '';
  while (i < block.length && depth > 0) {
    const c = block[i];
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    if (depth === 1 && c !== '}') top += c;
    i += 1;
  }
  return top;
}

/** True when a write block sets status to done or abandoned, or to something that is not a literal other than those. */
export function writesFinishedStatus(block: string): boolean {
  const m = dataObject(block).match(/\bstatus\s*:\s*([^,\n]+)/);
  if (!m) return false;
  const v = m[1].trim();
  const literal = v.match(/^(?:'([a-z_]+)'|"([a-z_]+)"|TaskStatus\.([a-z_]+))(?:\s+as\s+\w+)?$/);
  if (!literal) return true; // a variable or expression: cannot be named, so it must be covered
  const name = literal[1] ?? literal[2] ?? literal[3];
  return name === 'done' || name === 'abandoned';
}

const files = ['app', 'lib', 'components'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f);

describe('the one closure of a finished task\'s emails', () => {
  it('the scan helper tells a finished status from the rest', () => {
    expect(writesFinishedStatus("task.update({ where: { id }, data: { status: 'done' } })")).toBe(true);
    expect(writesFinishedStatus('task.updateMany({ where: {}, data: { status: TaskStatus.abandoned } })')).toBe(true);
    expect(writesFinishedStatus('task.update({ where: {}, data: { status: next } })')).toBe(true);
    expect(writesFinishedStatus("task.update({ where: {}, data: { status: 'in_progress' } })")).toBe(false);
    expect(writesFinishedStatus("task.create({ data: { title: 'x', status: 'not_started', priority: 3 } })")).toBe(false);
    expect(writesFinishedStatus("task.update({ where: {}, data: { tags: ['a'] } })")).toBe(false);
  });

  it('the known writers each call closeAsksForTask or closeAsksForTasks', () => {
    for (const f of REQUIRED) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, `${f} must call the closure`).toMatch(/\bcloseAsksForTasks?\(/);
    }
  });

  it('no other file writes a done or abandoned task status without it', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (REQUIRED.includes(r) || r in EXEMPT || r.startsWith('lib/work/')) continue;
      const src = fs.readFileSync(f, 'utf8');
      if (taskWrites(src).some(writesFinishedStatus)) offenders.push(`${r}: task write with a done, abandoned or unnamed status`);
      // Raw SQL: UPDATE tasks ... SET ... status
      for (const m of src.matchAll(/UPDATE\s+"?tasks"?[\s\S]{0,400}?(?:`|;)/gi)) {
        if (/\bstatus\s*=/i.test(m[0])) offenders.push(`${r}: UPDATE tasks sets status`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the status flows are still where the list says (a moved writer must update the list)', () => {
    for (const f of REQUIRED) {
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const hasWrite = taskWrites(src).some(writesFinishedStatus) || /UPDATE\s+tasks[\s\S]{0,400}status\s*=/i.test(src) || /status:\s*newStatus|\{\s*status\s*\}|StatusTransitionData/.test(src);
      expect(hasWrite, `${f} no longer writes a finished status; remove it from REQUIRED`).toBe(true);
    }
  });

  it('only the closure writes email_asks.state on a linked ask by task end (the closure is the single writer of task_done and task_abandoned)', () => {
    const hits = files.filter((f) => /closed_reason:\s*(?:reason|'task_done'|'task_abandoned')/.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual(['lib/work/ask-closure.ts']);
  });
});
