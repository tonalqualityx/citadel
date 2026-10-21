// @vitest-environment node
/**
 * The live end-to-end gate (phase C spec 11.6, 11.7): ONE real `claude -p` run, through the real
 * runner, against a real `next start` server on the SCRATCH database.
 *
 *   LIVE_CHAT_GATE=1 LIVE_CHAT_BASE=http://localhost:3000 DATABASE_URL=...scratch \
 *     npx vitest run lib/portal/chat/__tests__/live-gate.e2e.test.ts
 *
 * Citadel runs only in production and on the Next server; there is no other place to point the
 * runner. The test seeds a client with a Google Analytics property, signs a contact in, sends one
 * message over HTTP, runs `runner.py --once` (Opus), then asserts what the run left behind: an
 * EngineRun with cost, a gated reply, and the tool-call log with the numbers the reply used.
 * It prints the client message, the reply, the tool calls and the cost.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { prisma } from '@/lib/db/prisma';
import { hashApiKey } from '@/lib/auth/api-keys';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { consumeClientMagicLink, createContactPortalLoginLink, CLIENT_SESSION_COOKIE } from '@/lib/services/client-auth';
import { cleanupWorld, seedWorld, type World } from './harness/world';

const LIVE = process.env.LIVE_CHAT_GATE === '1' && /scratch/i.test(process.env.DATABASE_URL ?? '');
const BASE = process.env.LIVE_CHAT_BASE ?? 'http://localhost:3000';
const RUNNER = '/home/mike/.claude/tools/portal-chat/runner.py';
const TOKEN_FILE = path.join(os.homedir(), '.config', 'portal-chat', 'engine-token');
const MESSAGE = 'Hi! How many people visited our website last month?';

describe.skipIf(!LIVE)('live end-to-end gate (one real Opus run)', () => {
  let world: World;
  let keyId = '';
  let cookie = '';

  beforeAll(async () => {
    world = await seedWorld({ sites: 1, role: 'owner', analytics: true, pages: [{ title: 'Home', path: '/' }, { title: 'Contact', path: '/contact/' }] });
    // Point the one site at the real herbapumps.com properties (the spec's live lookups).
    await prisma.site.update({
      where: { id: world.sites[0].id },
      data: { url: 'https://herbapumps.com', name: 'herbapumps.com', ga4_property: 'properties/362082877', gsc_property: 'sc-domain:herbapumps.com' },
    });
    // An engine-scoped key for the runner, written to its token file (mode 600). Scratch only.
    const raw = 'citadel_' + crypto.randomBytes(16).toString('hex');
    await prisma.user.updateMany({ where: { id: BAST_USER_ID }, data: { role: 'pm', is_active: true } });
    keyId = (await prisma.apiKey.create({ data: { user_id: BAST_USER_ID, name: 'live-gate', key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 16), scopes: ['engine'] } })).id;
    fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
    fs.writeFileSync(TOKEN_FILE, raw + '\n', { mode: 0o600 });
    fs.chmodSync(TOKEN_FILE, 0o600);
    // Sign the owner in.
    const link = await createContactPortalLoginLink({ contactId: world.ownerId, send: false, ipAddress: '127.0.0.1', userAgent: 'live-gate' });
    const token = new URL(link!.url).searchParams.get('token') ?? link!.url.split('token=')[1];
    const session = await consumeClientMagicLink({ magicToken: token, ipAddress: '127.0.0.1', userAgent: 'live-gate' });
    cookie = `${CLIENT_SESSION_COOKIE}=${session!.sessionToken}`;
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { id: keyId } });
    await prisma.portalSession.deleteMany({ where: { contact_id: world.ownerId } });
    await cleanupWorld(world);
    await prisma.$disconnect();
  });

  it('one real run: an EngineRun, a gated reply, the tool-call log', async () => {
    const start = await fetch(`${BASE}/api/portal/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ intake_id: crypto.randomUUID(), client_ref: crypto.randomUUID(), text: MESSAGE }),
    });
    const started = await start.json();
    expect(start.status, JSON.stringify(started)).toBe(201);
    expect(started.mode).toBe('model');
    expect(started.route).toBe('queued');

    const run = spawnSync('python3', [RUNNER, '--once'], {
      encoding: 'utf8',
      timeout: 280_000,
      env: { ...process.env, CITADEL_BASE_URL: BASE, PORTAL_CHAT_FILE_TASKS: '0' },
    });
    expect(run.status, run.stderr.slice(-1500)).toBe(0);

    // Poll the client's own view until the reply lands.
    let view: any = null;
    for (let i = 0; i < 30; i++) {
      const res = await fetch(`${BASE}/api/portal/chat/${started.conversation_id}`, { headers: { cookie } });
      view = await res.json();
      if (!view.writing && view.messages.some((m: { who: string }) => m.who === 'assistant')) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    const reply = [...view.messages].reverse().find((m: { who: string }) => m.who === 'assistant');
    expect(reply, JSON.stringify(view)).toBeTruthy();

    const job = await prisma.engineJob.findFirstOrThrow({ where: { conversation_id: started.conversation_id }, include: { runs: true, tool_calls: true } });
    // The EngineRun row.
    expect(job.status).toBe('done');
    expect(job.runs.length).toBeGreaterThanOrEqual(1);
    const cost = job.runs.reduce((s, r) => s + Number(r.cost_usd), 0);
    expect(cost).toBeGreaterThan(0);
    expect(job.runs[0].model.toLowerCase()).toContain('opus');
    expect(job.runs[0].prompt_hash).toHaveLength(64);
    // A gated reply: it passed the copy gate in `complete` (a refusal would have been a 422 and a retry).
    expect(['pass', 'regenerated']).toContain(job.gate_result);
    expect(reply.text.length).toBeGreaterThan(10);
    // The tool-call log: a real Google Analytics lookup, logged with its result and the numbers.
    const ga = job.tool_calls.filter((c) => c.tool === 'ga4_report');
    expect(ga.length).toBeGreaterThanOrEqual(1);
    expect(ga[0].error).toBeNull();
    expect((ga[0].result as { label?: string }).label).toMatch(/^Google Analytics, /);
    expect(ga[0].result_numbers.length).toBeGreaterThan(0);
    // The deterministic source line under the reply.
    expect(reply.sources.length).toBeGreaterThanOrEqual(1);
    expect(reply.sources[0].label).toMatch(/^Google Analytics, /);
    // The runner logged its run.
    const log = fs.readFileSync(path.join(os.homedir(), '.local', 'log', 'portal-chat.log'), 'utf8');
    expect(log).toContain(`job ${job.id}`);

    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify(
        {
          client_message: MESSAGE,
          reply: reply.text,
          sources: reply.sources,
          gate_result: job.gate_result,
          attempts: job.runs.length,
          model: job.runs[0].model,
          cost_usd: Number(cost.toFixed(4)),
          num_turns: job.runs[0].num_turns,
          duration_ms: job.runs[0].duration_ms,
          tool_calls: job.tool_calls.map((c) => ({ tool: c.tool, args: c.args, row_count: c.row_count, latency_ms: c.latency_ms, error: c.error, label: (c.result as { label?: string } | null)?.label, numbers: c.result_numbers })),
          actions_errors: job.action_errors,
        },
        null,
        1
      )
    );
  }, 330_000);
});
