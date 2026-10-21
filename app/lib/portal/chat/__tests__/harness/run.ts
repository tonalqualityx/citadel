/**
 * The scripted-conversation harness (phase C spec 11.6). Each scenario is a JSON script of client
 * steps and, for each job, a RECORDED engine result ({result, tool_calls, runs}). The harness drives
 * the real routes against the real scratch database and plays the runner's part: it claims over
 * /api/engine/claim, logs every recorded tool call, and completes with the recording (and, when the
 * gate answers 422, with the next recording; after two refusals, `canned`). It then asserts the
 * saved comments, task tags and slots, the polled state, the gate outcome and the audit rows.
 *
 * Recordings come from record_fixtures.py (the real runner against a scratch Citadel) or are
 * written from the result contract; either way the test is deterministic and calls no model.
 */
import crypto from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { auth } from './auth-state';
import { seedWorld, cleanupWorld, cleanupStrays, type World, type WorldSpec } from './world';
import { POST as startRoute } from '@/app/api/portal/chat/route';
import { GET as viewRoute } from '@/app/api/portal/chat/[id]/route';
import { POST as messagesRoute } from '@/app/api/portal/chat/[id]/messages/route';
import { POST as confirmRoute } from '@/app/api/portal/chat/[id]/confirm/route';
import { POST as claimRoute } from '@/app/api/engine/claim/route';
import { POST as toolCallRoute } from '@/app/api/engine/jobs/[id]/tool-calls/route';
import { POST as completeRoute } from '@/app/api/engine/jobs/[id]/complete/route';
import { stageUpload } from '@/lib/portal/chat/upload-service';
import { resetGateListsCache } from '@/lib/portal/chat/gate-context';

export interface Recording {
  tool_calls?: Array<{ tool: string; args: Record<string, unknown>; result?: unknown; row_count?: number; error?: string }>;
  result: unknown;
  /** The status this post must get: 200 (default), 422, 409. */
  expect_status?: number;
  expect_rule?: string;
}

export interface Step {
  client?: { text?: string; choice?: { slot: string; label: string }; attach?: number; confirm?: boolean; project_label?: string };
  /** Recordings for the job this step queues, in order (a 422 takes the next one). Omit for no job. */
  engine?: Recording[] | 'down' | 'canned';
  expect?: Expect;
}

export interface Expect {
  route?: string;
  reply?: string;
  reply_contains?: string[];
  reply_excludes?: string[];
  tags_include?: string[];
  tags_exclude?: string[];
  state?: string;
  mode?: string;
  slots?: Record<string, unknown>;
  pending_kind?: string | null;
  pending_slot?: string;
  pending_labels?: string[];
  urgent_choices?: boolean;
  source_label?: string;
  gate_result?: string;
  tool_calls?: number;
  internal_note?: string;
  writing?: boolean;
  assistant_comments?: number;
  runs?: number;
  action_errors?: string[];
  title_starts?: string;
  waits_include?: string[];
  http?: number;
  error_code?: string;
}

export interface Scenario {
  name: string;
  world: WorldSpec;
  steps: Step[];
}

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(`http://localhost${url}`, init);
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

export interface Played {
  world: World;
  conversationId: string | null;
  taskId: string | null;
  views: Array<Record<string, any>>;
}

function resolve(value: unknown, w: World, extra: { att: string[]; tc: string[] }): unknown {
  if (typeof value === 'string') {
    return value
      .replace(/\{\{site:(\d+)\}\}/g, (_, i) => w.sites[Number(i)].id)
      .replace(/\{\{page:([^}]+)\}\}/g, (_, t) => w.pageIds[t] ?? `missing-page-${t}`)
      .replace(/\{\{att:(\d+)\}\}/g, (_, i) => extra.att[Number(i)] ?? 'missing-att')
      .replace(/\{\{tc:(\d+)\}\}/g, (_, i) => extra.tc[Number(i)] ?? 'missing-tc')
      .replace(/\{\{domain:(\d+)\}\}/g, (_, i) => w.sites[Number(i)].domain)
      .replace(/\{\{other\}\}/g, w.otherName);
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v, w, extra));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, w, extra)]));
  return value;
}

export async function mintEngineKey(): Promise<{ raw: string; id: string }> {
  const { hashApiKey } = await import('@/lib/auth/api-keys');
  const { BAST_USER_ID } = await import('@/lib/oracle/projects/gate-constants');
  await prisma.user.updateMany({ where: { id: BAST_USER_ID }, data: { role: 'pm', is_active: true } });
  const raw = 'citadel_' + crypto.randomBytes(16).toString('hex');
  const row = await prisma.apiKey.create({ data: { user_id: BAST_USER_ID, name: 'harness', key_hash: hashApiKey(raw), key_prefix: raw.slice(0, 16), scopes: ['engine'] } });
  return { raw, id: row.id };
}

export async function playScenario(sc: Scenario, engineKey: string, assertions: (label: string, actual: unknown, expected: unknown) => void): Promise<Played> {
  await cleanupStrays();
  const world = await seedWorld(sc.world);
  resetGateListsCache();
  const played: Played = { world, conversationId: null, taskId: null, views: [] };
  const intakeId = crypto.randomUUID();
  const extra = { att: [] as string[], tc: [] as string[] };
  try {
    for (const [n, step] of sc.steps.entries()) {
      const label = `${sc.name} step ${n + 1}`;
      auth.session = {
        clientId: world.clientId, contactId: world.contactId, contactIds: [world.contactId], role: sc.world.role,
        email: world.email, sessionId: 's', moved: false,
      };
      auth.bearer = null;
      let http = 200;
      let errorCode: string | undefined;
      let route: string | undefined;

      if (step.client) {
        const c = resolve(step.client, world, extra) as NonNullable<Step['client']>;
        const access = { contactId: world.contactId, contactIds: [world.contactId], clientId: world.clientId, role: sc.world.role };
        const attachIds: string[] = [];
        for (let i = 0; i < (c.attach ?? 0); i++) {
          const att = await stageUpload(access, { buffer: PNG, name: `IMG_${n}${i}.png`, ...(played.conversationId ? { conversation_id: played.conversationId } : { intake_id: intakeId }) });
          extra.att.push(att.id);
          attachIds.push(att.id);
        }
        if (c.confirm) {
          const v = played.views[played.views.length - 1];
          const body: Record<string, unknown> = { summary_version: v?.pending?.version ?? 0 };
          if (c.project_label) body.project_id = (v?.pending?.choose_project ?? []).find((p: { name: string }) => p.name === c.project_label)?.id;
          const res = await confirmRoute(req('/x', { method: 'POST', body: JSON.stringify(body) }), ctx(played.conversationId!));
          http = res.status;
          if (res.status >= 400) errorCode = (await res.json()).code;
        } else if (!played.conversationId) {
          const res = await startRoute(req('/x', { method: 'POST', body: JSON.stringify({ intake_id: intakeId, client_ref: crypto.randomUUID(), text: c.text, attachment_ids: attachIds }) }));
          http = res.status;
          const body = await res.json();
          if (res.status >= 400) errorCode = body.code;
          else {
            played.conversationId = body.conversation_id;
            played.taskId = body.task_id;
            route = body.route;
          }
        } else {
          const prev = played.views[played.views.length - 1];
          let choice: { slot: string; id: string } | undefined;
          if (c.choice) {
            const pool: Array<{ id: string; label: string }> =
              c.choice.slot === 'urgent' ? prev?.urgent?.choices ?? [] : c.choice.slot === 'summary' ? [{ id: 'change', label: c.choice.label }] : prev?.pending?.choices ?? [];
            const hit = pool.find((p) => p.label === c.choice!.label);
            choice = { slot: c.choice.slot, id: hit?.id ?? `no-such-choice:${c.choice.label}` };
          }
          const res = await messagesRoute(
            req('/x', { method: 'POST', body: JSON.stringify({ client_ref: crypto.randomUUID(), text: c.text ?? null, choice: choice ?? null, attachment_ids: attachIds }) }),
            ctx(played.conversationId)
          );
          http = res.status;
          const body = await res.json();
          if (res.status >= 400) errorCode = body.code;
          else route = body.route;
        }
      }

      // Play the runner.
      const job = played.conversationId ? await prisma.engineJob.findFirst({ where: { conversation_id: played.conversationId, status: 'queued' }, orderBy: { queued_at: 'desc' } }) : null;
      const recordings = step.engine;
      if (job && recordings === 'down') {
        await prisma.engineJob.update({ where: { id: job.id }, data: { queued_at: new Date(Date.now() - 61_000) } });
      } else if (job && recordings) {
        auth.bearer = engineKey;
        const claimed = await claimRoute(req('/x', { method: 'POST', body: '{}' }));
        assertions(`${label}: claim`, claimed.status, 200);
        const jobId = (await claimed.json()).job.id as string;
        const list: Recording[] = recordings === 'canned' ? [] : (recordings as Recording[]);
        const runs: Array<Record<string, unknown>> = [];
        extra.tc = [];
        let done = false;
        let attempt = 0;
        for (const rec of list) {
          attempt++;
          if (attempt === 1) {
            for (const tcall of rec.tool_calls ?? []) {
              const tr = await toolCallRoute(
                req('/x', { method: 'POST', body: JSON.stringify({ tool: tcall.tool, args: resolve(tcall.args, world, extra), result: resolve(tcall.result, world, extra), row_count: tcall.row_count ?? null, error: tcall.error ?? null }) }),
                ctx(jobId)
              );
              assertions(`${label}: tool-call logged`, tr.status, 201);
              extra.tc.push((await tr.json()).tool_call_id);
            }
          }
          const result = resolve(rec.result, world, extra) as { reply?: string };
          const run = { attempt, model: 'recorded', prompt_hash: 'h'.repeat(64), input_tokens: 100, cache_read_tokens: 50, cache_write_tokens: 10, output_tokens: 40, cost_usd: 0.01, duration_ms: 1000, num_turns: 1, is_error: false };
          const thisRuns = [...runs, { ...run }];
          const res = await completeRoute(req('/x', { method: 'POST', body: JSON.stringify({ result, runs: thisRuns }) }), ctx(jobId));
          const resBody = await res.json();
          assertions(`${label}: complete status ${JSON.stringify(resBody).slice(0, 200)}`, res.status, rec.expect_status ?? 200);
          if (rec.expect_rule) assertions(`${label}: rule`, resBody.rule, rec.expect_rule);
          if (res.status === 422) {
            runs.push({ ...run, rejected_text: result.reply ?? '' });
            continue;
          }
          done = true;
          break;
        }
        if (!done) {
          // Two refusals (or an explicit canned step): the fixed line and a handoff.
          const res = await completeRoute(req('/x', { method: 'POST', body: JSON.stringify({ canned: true, runs: runs.length ? runs : [{ attempt: 1, model: 'recorded', prompt_hash: 'h'.repeat(64), cost_usd: 0.01, is_error: false }] }) }), ctx(jobId));
          assertions(`${label}: canned status`, res.status, 200);
        }
        auth.bearer = null;
      }

      let viewRes = await viewRoute(req(`/x`), ctx(played.conversationId ?? crypto.randomUUID()));
      if (!played.conversationId) viewRes = new Response(null, { status: 404 }) as never;
      const view = played.conversationId ? await viewRes.json() : {};
      played.views.push(view);
      if (step.expect) await check(label, resolve(step.expect, world, extra) as Expect, { played, view, http, errorCode, route, world }, assertions);
    }
  } finally {
    auth.session = null;
    auth.bearer = null;
    await cleanupWorld(world);
  }
  return played;
}

async function check(
  label: string,
  e: Expect,
  s: { played: Played; view: Record<string, any>; http: number; errorCode?: string; route?: string; world: World },
  assertions: (l: string, a: unknown, b: unknown) => void
) {
  const { played, view } = s;
  if (e.http !== undefined) assertions(`${label}: http`, s.http, e.http);
  if (e.error_code) assertions(`${label}: error code`, s.errorCode, e.error_code);
  if (e.route) assertions(`${label}: route`, s.route, e.route);
  if (!played.conversationId) return;
  const comments = await prisma.comment.findMany({ where: { task_id: played.taskId! }, orderBy: { created_at: 'asc' } });
  const assistant = comments.filter((c) => c.source === 'assistant' && !c.is_internal);
  const last = assistant[assistant.length - 1];
  const task = await prisma.task.findUniqueOrThrow({ where: { id: played.taskId! } });
  const convo = await prisma.chatConversation.findUniqueOrThrow({ where: { id: played.conversationId } });
  if (e.reply !== undefined) assertions(`${label}: reply`, last?.content, e.reply);
  for (const t of e.reply_contains ?? []) assertions(`${label}: reply contains ${t}`, (last?.content ?? '').includes(t), true);
  for (const t of e.reply_excludes ?? []) assertions(`${label}: reply excludes ${t}`, assistant.some((c) => c.content.includes(t)), false);
  for (const t of e.tags_include ?? []) assertions(`${label}: tag ${t}`, task.tags.includes(t), true);
  for (const t of e.tags_exclude ?? []) assertions(`${label}: no tag ${t}`, task.tags.includes(t), false);
  if (e.state) assertions(`${label}: state`, convo.state, e.state);
  if (e.mode) assertions(`${label}: mode`, convo.mode, e.mode);
  if (e.slots) for (const [k, v] of Object.entries(e.slots)) assertions(`${label}: slot ${k}`, (convo.slots as Record<string, unknown>)[k], v);
  if (e.pending_kind !== undefined) assertions(`${label}: pending kind`, view.pending?.kind ?? null, e.pending_kind);
  if (e.pending_slot) assertions(`${label}: pending slot`, view.pending?.slot, e.pending_slot);
  if (e.pending_labels) assertions(`${label}: pending labels`, (view.pending?.choices ?? []).map((c: { label: string }) => c.label), e.pending_labels);
  if (e.urgent_choices !== undefined) assertions(`${label}: urgent choices`, Boolean(view.urgent), e.urgent_choices);
  if (e.source_label) {
    const msg = [...(view.messages ?? [])].reverse().find((m: { who: string }) => m.who === 'assistant');
    assertions(`${label}: source line`, (msg?.sources ?? []).map((x: { label: string }) => x.label).includes(e.source_label), true);
  }
  if (e.writing !== undefined) assertions(`${label}: writing`, view.writing, e.writing);
  if (e.assistant_comments !== undefined) assertions(`${label}: assistant comments`, assistant.length, e.assistant_comments);
  if (e.internal_note) assertions(`${label}: internal note`, comments.some((c) => c.is_internal && c.content.includes(e.internal_note!)), true);
  if (e.title_starts) assertions(`${label}: title`, task.title.startsWith(e.title_starts), true);
  const job = await prisma.engineJob.findFirst({ where: { conversation_id: played.conversationId, status: 'done' }, orderBy: { finished_at: 'desc' }, include: { runs: true } });
  if (e.gate_result) assertions(`${label}: gate result`, job?.gate_result, e.gate_result);
  if (e.runs !== undefined) assertions(`${label}: runs`, job?.runs.length, e.runs);
  if (e.action_errors) {
    const errs = ((job?.action_errors as Array<{ error: string }> | null) ?? []).map((x) => x.error);
    for (const x of e.action_errors) assertions(`${label}: action error ${x}`, errs.includes(x), true);
  }
  if (e.tool_calls !== undefined) assertions(`${label}: tool calls`, await prisma.engineToolCall.count({ where: { conversation_id: played.conversationId } }), e.tool_calls);
  if (e.waits_include) {
    const waits = await prisma.wait.findMany({ where: { task_id: played.taskId! }, select: { template_key: true } });
    for (const w of e.waits_include) assertions(`${label}: wait ${w}`, waits.some((x) => x.template_key === w), true);
  }
}

export { cleanupWorld };
