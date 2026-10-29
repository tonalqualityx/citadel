/**
 * Plays the design daemon through the worker API (design 7.3) with the enforced lane key: heartbeat, inbox,
 * claiming a new session (preview + status), events, changes, assets, publish completion. No UI, no database.
 */
import { BASE_SHA, NEXT_SHA, TINY_PNG, type DesignWorld } from './design-portal-fixture';

export interface ApiResult<T = unknown> {
  status: number;
  json: T;
}

/** The payload of an `apply` message: what the designer attached and pinned. */
export interface ApplyPayload {
  note?: string;
  pins: Array<{ pin_id: string; data_lib?: string; sha?: string; note?: string; viewport: { w: number; h?: number } }>;
  files: Array<{ id: string; name: string; mime: string }>;
}

export interface InboxMessage {
  session_id: string;
  seq: number;
  kind: string;
  payload: unknown;
}

export type ApplyMessage = Omit<InboxMessage, 'payload'> & { payload: ApplyPayload };

export interface WorkerCommand {
  id: string;
  session_id: string;
  verb: string;
  payload: { publish_id: string };
  publish?: { live_url?: string | null } | null;
}

export class DesignWorker {
  constructor(
    private readonly base: string,
    private readonly world: Pick<DesignWorld, 'workerKey' | 'siteA' | 'siteB' | 'siteC' | 'siteMainRoles' | 'siteLiveUrls'>,
  ) {}

  /** Every request the worker has made: [method, path, status]. */
  readonly log: Array<[string, string, number]> = [];

  async api<T = unknown>(method: string, path: string, body?: unknown, raw?: FormData): Promise<ApiResult<T>> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.world.workerKey}`, ...(raw ? {} : { 'content-type': 'application/json' }) },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
    const text = await res.text();
    let json: T;
    try {
      json = (text ? JSON.parse(text) : null) as T;
    } catch {
      json = text as T;
    }
    this.log.push([method, path, res.status]);
    return { status: res.status, json };
  }

  async ok<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
    const r = await this.api<T>(method, path, body);
    if (r.status >= 300) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json;
  }

  heartbeat(sessions: Array<{ id: string; alive: boolean }> = []) {
    const w = this.world;
    return this.ok('POST', '/api/design/worker/heartbeat', {
      version: 'e2e', sdk_version: 'e2e', paused: false,
      configured_site_ids: [w.siteA.id, w.siteB.id, w.siteC.id],
      site_main_roles: w.siteMainRoles, site_live_urls: w.siteLiveUrls, sessions,
    });
  }

  inbox() {
    return this.ok<{ commands: WorkerCommand[]; messages: InboxMessage[]; new_sessions: Array<{ id: string; preview_alias: string }> }>('GET', '/api/design/worker/inbox?max=100');
  }

  async until<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
    const end = Date.now() + timeoutMs;
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() > end) throw new Error(`worker timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 400));
    }
  }

  /** Waits for the session to show up as new, then points it at the fixture preview and moves it to awaiting_input. */
  async claimAndSetUp(sessionId: string, opts: { previewHost?: string; sha?: string } = {}): Promise<{ previewUrl: string; alias: string }> {
    await this.heartbeat();
    const fresh = await this.until(`new session ${sessionId}`, async () => (await this.inbox()).new_sessions.find((s) => s.id === sessionId));
    const sha = opts.sha ?? BASE_SHA;
    const previewUrl = `https://${fresh.preview_alias}.${opts.previewHost ?? 'dpe2e'}.pages.dev/`;
    await this.ok('PATCH', `/api/design/worker/sessions/${sessionId}`, {
      preview_url: previewUrl, preview_sha: sha, base_sha: sha, head_sha: sha, worktree_path: '/tmp/dpe2e', status: 'awaiting_input',
    });
    return { previewUrl, alias: fresh.preview_alias };
  }

  postEvents(sessionId: string, events: Array<{ role: 'assistant' | 'tool' | 'system'; kind: string; payload: unknown; turn?: number }>, acks: number[] = []) {
    return this.ok<{ last_seq: number }>('POST', `/api/design/worker/sessions/${sessionId}/events`, { acks, events });
  }

  async uploadPng(sessionId: string, kind: 'before' | 'after' | 'crop', width: number): Promise<string> {
    const form = new FormData();
    form.set('file', new Blob([new Uint8Array(TINY_PNG)], { type: 'image/png' }), `${kind}-${width}.png`);
    form.set('kind', kind);
    form.set('width', String(width));
    const r = await this.api<{ asset_id: string }>('POST', `/api/design/worker/sessions/${sessionId}/assets`, undefined, form);
    if (r.status !== 201) throw new Error(`asset upload -> ${r.status} ${JSON.stringify(r.json)}`);
    return r.json.asset_id;
  }

  /** The next Apply message for the session that has not been acked. */
  async waitForApply(sessionId: string): Promise<ApplyMessage> {
    const m = await this.until('an apply message', async () => (await this.inbox()).messages.find((x) => x.session_id === sessionId && x.kind === 'apply'));
    return { ...m, payload: m.payload as ApplyPayload };
  }

  /**
   * One full turn for an Apply: active, plan, action/result, text, before/after shots, a recorded change that
   * resolves the pins, a change event, cost, then back to awaiting_input with a green precheck for the new head.
   */
  async runApplyTurn(sessionId: string, apply: ApplyMessage, opts: { cost?: number } = {}): Promise<{ changeId: string }> {
    const pinIds: string[] = (apply.payload.pins ?? []).map((p) => p.pin_id);
    await this.ok('PATCH', `/api/design/worker/sessions/${sessionId}`, { status: 'active', live_text: 'Working on it', live_action: 'Editing state_card' });
    await this.postEvents(sessionId, [
      { role: 'assistant', kind: 'plan', payload: { items: [{ text: 'Find the state card', status: 'completed' }, { text: 'Edit the heading', status: 'in_progress' }] }, turn: 1 },
      { role: 'tool', kind: 'action', payload: { tool: 'edit_file', label: 'Editing the state card', args_summary: 'src/_includes/state_card.njk', tool_use_id: 'tu-1' }, turn: 1 },
      { role: 'tool', kind: 'result', payload: { tool: 'edit_file', ok: true, summary: 'Heading updated', duration_ms: 120, tool_use_id: 'tu-1' }, turn: 1 },
      { role: 'assistant', kind: 'text', payload: { text: 'I made the card heading larger.' }, turn: 1 },
    ], [apply.seq]);
    const before = [await this.uploadPng(sessionId, 'before', 390), await this.uploadPng(sessionId, 'before', 768)];
    const after = [await this.uploadPng(sessionId, 'after', 390), await this.uploadPng(sessionId, 'after', 768)];
    const change = await this.ok<{ change: { id: string } }>('POST', `/api/design/worker/sessions/${sessionId}/changes`, {
      commit_sha: NEXT_SHA, parent_sha: BASE_SHA, summary: 'Made the state card heading larger',
      files: ['src/_includes/state_card.njk'], data_libs: ['state_card'], pages: ['/'], render_count: 1, pin_ids: pinIds, apply_event_seq: apply.seq,
      gates: [{ name: 'build', ok: true }],
    });
    await this.ok('PATCH', `/api/design/worker/changes/${change.change.id}`, { before_asset_ids: before, after_asset_ids: after });
    await this.postEvents(sessionId, [
      { role: 'tool', kind: 'screenshot', payload: { asset_ids: [...before, ...after], widths: [390, 768, 390, 768], purpose: 'after' }, turn: 1 },
      { role: 'system', kind: 'change', payload: { change_id: change.change.id }, turn: 1 },
      { role: 'system', kind: 'cost', payload: { turn_usd: 0.42, total_usd: opts.cost ?? 0.42, budget_usd: 25 }, turn: 1 },
    ]);
    await this.ok('PATCH', `/api/design/worker/sessions/${sessionId}`, {
      cost_usd: opts.cost ?? 0.42, head_sha: NEXT_SHA, preview_sha: NEXT_SHA, live_text: null, live_action: null,
      diff_summary: { files_changed: 1, insertions: 3, deletions: 1 },
      publish_precheck: {
        head_sha: NEXT_SHA, gates_ok: true,
        gates: [{ name: 'build', ok: true, summary: 'built 2 pages' }, { name: 'a11y', ok: true, summary: '0 violations' }],
        files_changed: ['src/_includes/state_card.njk'], pages_affected: ['/'],
      },
      status: 'awaiting_input',
    });
    return { changeId: change.change.id };
  }

  /** Plays a queued publish/rollback command: claim, running, published, complete. Returns the command and publish ids. */
  async completePublish(sessionId: string, opts: { resultSha?: string } = {}): Promise<{ commandId: string; publishId: string; verb: string }> {
    const cmd: WorkerCommand = await this.until('a publish command', async () =>
      (await this.inbox()).commands.find((c) => c.session_id === sessionId && (c.verb === 'publish' || c.verb === 'rollback')),
    );
    const publishId: string = cmd.payload.publish_id;
    await this.ok('PATCH', `/api/design/worker/commands/${cmd.id}`, { action: 'claim' });
    await this.ok('PATCH', `/api/design/worker/publishes/${publishId}`, { status: 'running', from_main_sha: '1111111111111111111111111111111111111111' });
    await this.ok('PATCH', `/api/design/worker/publishes/${publishId}`, {
      status: 'published', from_main_sha: '1111111111111111111111111111111111111111', result_sha: opts.resultSha ?? NEXT_SHA,
      deploy_id: 'dpe2e-deploy', alias_url: cmd.publish?.live_url ?? undefined,
    });
    await this.ok('PATCH', `/api/design/worker/commands/${cmd.id}`, { action: 'complete', status: 'done' });
    return { commandId: cmd.id, publishId, verb: cmd.verb };
  }
}
