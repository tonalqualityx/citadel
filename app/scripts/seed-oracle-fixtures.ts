/**
 * Dev fixture seed for the Oracle fleet visualizer (Phase 1, Task A hand-off to Task B).
 *
 * Inserts a realistic demo fleet so the UI can be built against real rows without
 * waiting on live telemetry from the hook script / heartbeat cron:
 *   - 2 running Claude Code sessions
 *   - 1 waiting Claude Code session with needs_attention set
 *   - 1 Workflow fan-out session with 6 agents in mixed states (done/running/failed/queued)
 *   - 1 "working" orchestrator (Phase 2): Claude Code session that reads
 *     waiting+needs_attention on its own stored status but has a live running child
 *     agent — must be excluded from the Waiting-on-Reshi strip and show a
 *     "working · N agents" badge instead
 *   - 1 openclaw cron session (already ended)
 *   - a handful of OracleEvent rows powering the drawer
 *
 * Idempotent: all demo rows use an external_id prefixed "demo-" and are deleted and
 * re-created on every run, so it's safe to re-run without piling up duplicates.
 * Local dev only — this seeds whatever DATABASE_URL points at; never point it at prod.
 *
 * Run with:
 *   npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/seed-oracle-fixtures.ts
 */
import { PrismaClient, OracleSource, OracleSessionStatus } from '@prisma/client';

const prisma = new PrismaClient();

const MACHINE_NAME = 'reshi-workstation';
const DEMO_PREFIX = 'demo-';

async function main() {
  console.log('Oracle fixtures: upserting demo machine...');

  const machine = await prisma.oracleMachine.upsert({
    where: { name: MACHINE_NAME },
    update: { last_heartbeat_at: new Date(), hostname: 'reshi-workstation.local' },
    create: { name: MACHINE_NAME, hostname: 'reshi-workstation.local', last_heartbeat_at: new Date() },
  });

  const priorDemoSessions = await prisma.oracleSession.findMany({
    where: { machine_id: machine.id, external_id: { startsWith: DEMO_PREFIX } },
    select: { id: true },
  });
  const priorIds = priorDemoSessions.map((s) => s.id);
  if (priorIds.length > 0) {
    await prisma.oracleEvent.deleteMany({ where: { session_id: { in: priorIds } } });
    await prisma.oracleAgent.deleteMany({ where: { session_id: { in: priorIds } } });
    await prisma.oracleSession.deleteMany({ where: { id: { in: priorIds } } });
  }
  console.log(`  removed ${priorIds.length} prior demo session(s)`);

  const now = Date.now();
  const minutesAgo = (m: number) => new Date(now - m * 60_000);

  // --- 2 running Claude Code sessions ---
  const running1 = await prisma.oracleSession.create({
    data: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: `${DEMO_PREFIX}session-running-1`,
      title: 'oracle-phase1-visualizer (Task A)',
      cwd: '/home/mike/.openclaw/workspace/citadel',
      model: 'claude-sonnet-5',
      status: OracleSessionStatus.running,
      started_at: minutesAgo(42),
      last_event_at: minutesAgo(1),
      tokens_total: 184_320,
    },
  });

  const running2 = await prisma.oracleSession.create({
    data: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: `${DEMO_PREFIX}session-running-2`,
      title: 'botanicaldream — Adaptogens post',
      cwd: '/home/mike/Documents/herbaldream',
      model: 'claude-sonnet-5',
      status: OracleSessionStatus.running,
      started_at: minutesAgo(15),
      last_event_at: minutesAgo(0),
      tokens_total: 22_540,
    },
  });

  // --- 1 waiting session, needs_attention ---
  const waiting1 = await prisma.oracleSession.create({
    data: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: `${DEMO_PREFIX}session-waiting-1`,
      title: 'grantibly-wright-b1 — gate review',
      cwd: '/home/mike/.openclaw/workspace/clients/grantibly',
      model: 'claude-opus-4-5',
      status: OracleSessionStatus.waiting,
      needs_attention: true,
      attention_reason: 'Approval needed: publish B1 gate deliverable to Grantibly microsite.',
      started_at: minutesAgo(96),
      last_event_at: minutesAgo(22),
      tokens_total: 401_880,
    },
  });

  // --- 1 workflow session with 6 agents in mixed states ---
  const workflow1 = await prisma.oracleSession.create({
    data: {
      machine_id: machine.id,
      source: OracleSource.workflow,
      external_id: `${DEMO_PREFIX}wf-run-2026-07-09-01`,
      title: 'Wright: Odd Fox white-label build — page fan-out',
      cwd: '/home/mike/.openclaw/workspace/citadel',
      model: 'claude-sonnet-5',
      status: OracleSessionStatus.running,
      started_at: minutesAgo(28),
      last_event_at: minutesAgo(0),
      tokens_total: 512_003,
    },
  });

  const agentSpecs: Array<{
    label: string;
    phase: string;
    status: 'done' | 'running' | 'failed' | 'queued';
    tokens: number;
    duration_ms: number | null;
  }> = [
    { label: 'Homepage build', phase: 'component-assembly', status: 'done', tokens: 88_400, duration_ms: 612_000 },
    { label: 'Services page build', phase: 'component-assembly', status: 'done', tokens: 74_120, duration_ms: 543_000 },
    { label: 'About page build', phase: 'copy-pass', status: 'running', tokens: 51_900, duration_ms: null },
    { label: 'Contact page build', phase: 'copy-pass', status: 'running', tokens: 39_700, duration_ms: null },
    { label: 'Responsive gate sweep', phase: 'verification', status: 'failed', tokens: 12_050, duration_ms: 88_000 },
    { label: 'SEO pass', phase: 'queued', status: 'queued', tokens: 0, duration_ms: null },
  ];

  for (const [i, spec] of agentSpecs.entries()) {
    await prisma.oracleAgent.create({
      data: {
        session_id: workflow1.id,
        external_id: `${DEMO_PREFIX}wf-agent-${i + 1}`,
        label: spec.label,
        phase: spec.phase,
        model: 'claude-sonnet-5',
        status: spec.status,
        activity:
          spec.status === 'running'
            ? 'Writing component markup...'
            : spec.status === 'failed'
              ? 'Breakpoint overflow at 360px'
              : null,
        tokens: spec.tokens,
        duration_ms: spec.duration_ms,
        started_at: spec.status === 'queued' ? null : minutesAgo(28),
        ended_at: spec.status === 'done' || spec.status === 'failed' ? minutesAgo(3) : null,
      },
    });
  }

  // --- 1 "working" orchestrator: Stop-hook waiting/needs_attention on its OWN
  // status, but with a live running child agent — Phase 2's core fix target. Must
  // NOT appear in the Waiting-on-Reshi strip and must render the "working · N
  // agents" badge, expanding to show its child. ---
  const orchestratorWorking = await prisma.oracleSession.create({
    data: {
      machine_id: machine.id,
      source: OracleSource.claude_code,
      external_id: `${DEMO_PREFIX}session-orchestrator-working-1`,
      title: 'Oracle Task B — orchestrator fan-out',
      cwd: '/home/mike/.openclaw/workspace/citadel',
      model: 'claude-opus-4-5',
      status: OracleSessionStatus.waiting,
      needs_attention: true,
      attention_reason: 'Stop hook fired while background subagent still running.',
      started_at: minutesAgo(9),
      last_event_at: minutesAgo(1),
      tokens_total: 61_204,
    },
  });

  await prisma.oracleAgent.create({
    data: {
      session_id: orchestratorWorking.id,
      external_id: `${DEMO_PREFIX}orch-child-a0`,
      label: 'Fix false "waiting on Reshi" status',
      phase: 'implementation',
      model: 'claude-sonnet-5',
      status: 'running',
      activity: 'Editing oracle-logic.ts',
      tokens: 14_820,
      duration_ms: null,
      started_at: minutesAgo(6),
      ended_at: null,
    },
  });

  // --- 1 openclaw cron (already ended) ---
  const cron1 = await prisma.oracleSession.create({
    data: {
      machine_id: machine.id,
      source: OracleSource.openclaw_cron,
      external_id: `${DEMO_PREFIX}cron-daily-checkin`,
      title: 'daily-check-in',
      status: OracleSessionStatus.ended,
      started_at: minutesAgo(480),
      last_event_at: minutesAgo(479),
      ended_at: minutesAgo(479),
      tokens_total: 0,
    },
  });

  // --- events for the drawer ---
  const eventSeed: Array<{ session_id: string; kind: string; payload: object; ts: Date }> = [
    { session_id: running1.id, kind: 'SessionStart', payload: { cwd: running1.cwd }, ts: minutesAgo(42) },
    {
      session_id: running1.id,
      kind: 'UserPromptSubmit',
      payload: { prompt_preview: 'Build Task A per the Oracle spec' },
      ts: minutesAgo(41),
    },
    {
      session_id: running1.id,
      kind: 'UserPromptSubmit',
      payload: { prompt_preview: 'Continue — run the gates' },
      ts: minutesAgo(5),
    },
    { session_id: running2.id, kind: 'SessionStart', payload: { cwd: running2.cwd }, ts: minutesAgo(15) },
    { session_id: waiting1.id, kind: 'Stop', payload: {}, ts: minutesAgo(22) },
    {
      session_id: waiting1.id,
      kind: 'Notification',
      payload: { message: 'Approval needed: publish B1 gate deliverable to Grantibly microsite.' },
      ts: minutesAgo(22),
    },
    { session_id: orchestratorWorking.id, kind: 'Stop', payload: {}, ts: minutesAgo(1) },
    {
      session_id: workflow1.id,
      kind: 'workflow_progress',
      payload: { agents_done: 2, agents_total: 6 },
      ts: minutesAgo(3),
    },
    { session_id: cron1.id, kind: 'SessionEnd', payload: { exit_code: 0 }, ts: minutesAgo(479) },
  ];

  for (const e of eventSeed) {
    await prisma.oracleEvent.create({
      data: { session_id: e.session_id, machine_id: machine.id, kind: e.kind, payload: e.payload, ts: e.ts },
    });
  }

  console.log('Oracle fixtures: demo fleet inserted.');
  console.log(`  machine: ${machine.name} (${machine.id})`);
  console.log(
    '  sessions: running x2, waiting x1 (needs_attention), workflow x1 (6 agents), ' +
      'orchestrator-working x1 (1 running child), cron x1'
  );
  console.log(`  events: ${eventSeed.length}`);
}

main()
  .catch((e) => {
    console.error('Oracle fixture seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
