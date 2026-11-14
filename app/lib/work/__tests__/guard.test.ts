// @vitest-environment node
/**
 * Work stage D invariant: no path creates a task without asking the guard. Same grep style as ask-closure-callers.test.ts.
 *   1. every file that creates a Task (`task.create`, `createMany`, `upsert`) either calls checkTracked (or handledElsewhere, or the
 *      op helper refuseIfTracked) imported from lib/work/guard, or is named in EXEMPT with the reason it has no source to attach;
 *   2. the home loader, select, the reconciler and the keeper's arc steps are guarded the way the plan lists;
 *   3. a new create path fails (1) until it calls the guard or is named, and a stale EXEMPT entry fails too.
 * Also the pure rule: which targets handle a source (open work, finished after the latest activity), and which never do.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { targetHandles } from '../guard';

const ROOT = path.resolve(__dirname, '../../..');
const SKIP = new Set(['node_modules', '.next', '__tests__', 'e2e', 'prisma']);

/** Files that create a task and must ask the guard first. The guard is the call named in the second column. */
const GUARDED: Record<string, RegExp> = {
  'app/api/tasks/route.ts': /\bcheckTracked\(/, // POST /api/tasks (source_key, and source_ref/source_rfc of an email task)
  'app/api/session-tasks/route.ts': /\bcheckTracked\(/, // POST /api/session-tasks
  'app/api/email-asks/[id]/create-task/route.ts': /\bcheckTracked\(/, // POST /api/email-asks/:id/create-task
  'lib/bast-chat/ops/start-common.ts': /\brefuseIfTracked\(/, // the chat's start_project (its kickoff task); createStartTask asks first
  'lib/home/reconcile/track.ts': /\bcheckTracked\(/, // Track it, re-read at the tap
  'lib/work/attach-store.ts': /\bcheckTracked\(/, // the owner's own "Just a task" answer: the explicit override, named
  'lib/work/session-track.ts': /\bcheckTracked\(/, // Work stage E: "Track this?" from a session (new work is guarded; a named live project takes its tasks)
};

/** Files that create a task with no email or session behind it to attach, with the reason. */
const EXEMPT: Record<string, string> = {
  'app/api/portal/tasks/[token]/new-task/route.ts': 'a client request from the portal; the portal is unchanged by this stage',
  'lib/portal/chat/file-early.ts': 'a client request filed from the portal chat; unchanged',
  'lib/portal/intake/file-request.ts': 'a client request filed from the portal intake; unchanged',
  'app/api/projects/wizard/route.ts': 'the tasks of a project the owner is creating in the wizard; no source',
  'app/api/bug-report/route.ts': 'a bug report from the app itself; no source',
  'app/api/approval-requests/[id]/route.ts': 'the follow-up task of a client change request on an existing task of that project',
  'app/api/meetings/[id]/tasks/route.ts': 'an action item the owner makes from a meeting, by hand',
  'lib/design/work.ts': 'the designer portal; its own tasks',
  'lib/design/followups.ts': 'the designer portal; its own follow-ups',
  'lib/waits/prisma-store.ts': 'the task of a wait (the wait is the record; its own idempotent source_ref)',
  'lib/services/sales-automation.ts': 'a generator for a deal, not a message or a session',
  'lib/services/charter-generator.ts': 'a generator for a charter period',
  'lib/services/maintenance-generator.ts': 'a generator for a maintenance period',
  'lib/services/kickoff.ts': 'the kickoff tasks of a signed proposal',
  'lib/engagement/client-report.ts': 'the draft task for the owner when a client report is handed in; no email or session behind it',
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
  }
  return out;
}

/** True when the source creates a task: `task.create(`, `tasks.create(`, `.task.createMany(`, `.task.upsert(`. */
export function createsTask(src: string): boolean {
  return /\b(?:task|tasks)\.(?:create|createMany|upsert)\(/.test(src);
}

const files = ['app', 'lib', 'components'].filter((d) => fs.existsSync(path.join(ROOT, d))).flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f: string) => path.relative(ROOT, f);
const read = (r: string) => fs.readFileSync(path.join(ROOT, r), 'utf8');

describe('the scan helper', () => {
  it('sees a create and ignores a read or an update', () => {
    expect(createsTask('const t = await tx.task.create({ data })')).toBe(true);
    expect(createsTask('await prisma.task.createMany({ data })')).toBe(true);
    expect(createsTask('await db.task.upsert({})')).toBe(true);
    expect(createsTask('await db.task.findMany({})')).toBe(false);
    expect(createsTask('await db.task.update({ where, data })')).toBe(false);
    expect(createsTask('await db.workLink.create({})')).toBe(false);
  });
});

describe('every task-create path asks the guard', () => {
  it('each guarded file imports it from lib/work/guard and calls it', () => {
    for (const [f, call] of Object.entries(GUARDED)) {
      const src = read(f);
      expect(src, `${f} must import from lib/work/guard`).toMatch(/from '(?:@\/lib\/work\/guard|\.\/guard)'/);
      expect(src, `${f} must call the guard`).toMatch(call);
    }
  });

  it('no other file creates a task unless it is named exempt with a reason', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const r = rel(f);
      if (r in GUARDED || r in EXEMPT) continue;
      if (createsTask(fs.readFileSync(f, 'utf8'))) offenders.push(r);
    }
    expect(offenders, 'a new task-create path must call checkTracked (lib/work/guard) or be named in EXEMPT with its reason').toEqual([]);
  });

  it('the lists are still true (a moved or changed path must update them)', () => {
    for (const f of [...Object.keys(GUARDED), ...Object.keys(EXEMPT)]) {
      expect(fs.existsSync(path.join(ROOT, f)), `${f} no longer exists`).toBe(true);
      expect(createsTask(read(f)), `${f} no longer creates a task; remove it from the list`).toBe(true);
    }
    for (const [f, why] of Object.entries(EXEMPT)) {
      expect(why.length, `${f} needs a reason`).toBeGreaterThan(10);
      expect(read(f), `${f} is exempt, so it must not carry the guard`).not.toMatch(/\bcheckTracked\(/);
    }
  });

  it('no raw SQL inserts a task', () => {
    const hits = files.filter((f) => /INSERT\s+INTO\s+"?tasks"?\b/i.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });

  it('an explicit owner override is honoured only for the owner (a browser session or the chat), never a machine lane', () => {
    const src = read('lib/work/tracked.ts');
    expect(src).toMatch(/auth\.via === 'session' \|\| auth\.lane === CHAT_LANE/);
  });
});

describe('every home row source is guarded', () => {
  it('the loader applies the guard to mail, session questions and Track it cards', () => {
    const src = read('lib/home/load.ts');
    expect(src).toMatch(/handledAskIds\(/);
    expect(src).toMatch(/guardSessionAsks\(/);
    expect(src).toMatch(/attachedTrackCardIds\(/);
    expect(read('lib/work/home-guard.ts')).toMatch(/handledElsewhereMany\(/);
  });

  it('select drops the keys the guard found, for session cards and thread rows', () => {
    const src = read('lib/home/select.ts');
    expect(src).toMatch(/raw\.handled_elsewhere/);
    expect(src).toMatch(/keptOff\.has\(sessionKey\(/);
    expect(src).toMatch(/keptOff\.has\(key\)/);
  });

  it('the reconciler never proposes Track it for an attached conversation, and the candidates carry the attachment', () => {
    expect(read('lib/home/reconcile/store.ts')).toMatch(/attachedWork\(/);
    expect(read('lib/home/reconcile/load.ts')).toMatch(/attached: await attachedWork\(/);
  });

  it("the keeper's arc steps come from select's rows, which are guarded", () => {
    const src = read('lib/home/keeper/arcs.ts');
    expect(src).toMatch(/import \{[^}]*selectHome[^}]*\} from '\.\.\/select'/);
    expect(read('lib/home/keeper/run.ts')).toMatch(/loadHomeInputs/);
  });

  it('crisis mail is loaded without the guard (urgent items keep their own path)', () => {
    const src = read('lib/home/load.ts');
    const crises = src.slice(src.indexOf('async function loadCrises'), src.indexOf('async function loadAutoHandled'));
    expect(crises).not.toMatch(/handled/i);
  });
});

describe('targetHandles: which work carries a source', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 10, d, 12));
  const task = (over: Partial<{ status: string; is_deleted: boolean; completed_at: Date | null; updated_at: Date; tags: string[] }> = {}) => ({
    type: 'task' as const,
    row: { id: 't', title: 'T', status: 'in_progress', is_deleted: false, completed_at: null, updated_at: day(1), tags: [] as string[], ...over },
  });
  const project = (over: Partial<{ status: string; is_deleted: boolean; completed_date: Date | null; updated_at: Date }> = {}) => ({
    type: 'project' as const,
    row: { id: 'p', name: 'P', status: 'in_progress', is_deleted: false, completed_date: null, updated_at: day(1), ...over },
  });

  it('an open task carries it, whatever its activity', () => {
    for (const status of ['not_started', 'in_progress', 'review', 'blocked']) expect(targetHandles(task({ status }), day(9))).toBe('open');
  });
  it('a done task carries it only when it finished after the latest activity', () => {
    expect(targetHandles(task({ status: 'done', completed_at: day(5) }), day(4))).toBe('done');
    expect(targetHandles(task({ status: 'done', completed_at: day(5) }), day(5))).toBeNull();
    expect(targetHandles(task({ status: 'done', completed_at: day(5) }), day(6))).toBeNull();
    expect(targetHandles(task({ status: 'done', completed_at: null, updated_at: day(7) }), day(6))).toBe('done');
  });
  it('an abandoned or deleted task never carries it', () => {
    expect(targetHandles(task({ status: 'abandoned' }), day(1))).toBeNull();
    expect(targetHandles(task({ is_deleted: true }), day(1))).toBeNull();
  });
  it('a security-tagged task never hides its source', () => {
    expect(targetHandles(task({ tags: ['security'] }), day(1))).toBe('security');
    expect(targetHandles(task({ tags: ['Security-Report'] }), day(1))).toBe('security');
  });
  it('a live project carries it; quote, queue, suspended and cancelled do not; a done one only after the latest activity', () => {
    for (const status of ['ready', 'in_progress', 'review']) expect(targetHandles(project({ status }), day(9))).toBe('open');
    for (const status of ['quote', 'queue', 'suspended', 'cancelled']) expect(targetHandles(project({ status }), day(1))).toBeNull();
    expect(targetHandles(project({ status: 'done', completed_date: day(5) }), day(4))).toBe('done');
    expect(targetHandles(project({ status: 'done', completed_date: day(5) }), day(6))).toBeNull();
    expect(targetHandles(project({ is_deleted: true }), day(1))).toBeNull();
  });
});
