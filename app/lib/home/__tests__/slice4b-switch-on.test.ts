import { describe, it, expect } from 'vitest';
import { selectHome } from '../select';
import { threadKey } from '../item-key';
import { homeActSchema } from '../act';
import { projectDrawerItems } from '../projects/drawer';
import { HANDS_ITEM_KEY } from '../emergency/hands';
import { siteItemKey } from '../emergency/site';
import { makeRow } from '../owed/__tests__/fixtures/owed-row';
import { d, makeClient, makeInputs, makeProject, makeTask, makeThread, nextId } from './fixtures/tonight';
import type { HomeItem, RawHomeInputs, RawProjectStep, RawSiteIncident } from '../types';

// Slice 4b shipped switched ON: the card and button wiring Slice 8a's drawer and 8b's step rows share must give
// Send the draft to a ready owed-reply thread and to nothing else.
const TUE = d('2026-11-10T15:00:00Z');
const TZ = 'America/New_York';
const sel = (raw: Partial<RawHomeInputs>) => selectHome({ raw: makeInputs({ now: TUE, owed_send: true, ...raw }), states: [], now: TUE });
const isSend = (a: { id: string }) => a.id === 'send_draft' || a.id === 'send_short';
const hasSend = (i: HomeItem) => [...i.actions, ...i.more_actions].some(isSend);

describe('Slice 4b switched on: Send the draft in the project drawer and nowhere else', () => {
  const project = makeProject('Grok rebuild');
  const client = makeClient('Gene Roberts');
  const t = makeThread({ client, project, received_at: d('2026-11-03T15:00:00Z') });
  const key = threadKey(t.account, t.thread_id);
  const drafted = makeRow({ thread_key: key, state: 'drafted', draft_id: 'g1', draft_for_ask_id: t.asks[0].id, draft_text: 'Thanks, got this.', short_draft_id: 's1', short_draft_text: 'Short.' });

  it('the drawer item for the thread carries the same Send buttons and draft ids as the main list', () => {
    const r = sel({ threads: [t], owed_rows: [drafted] });
    const main = r.candidates.find((c) => c.key === key)!.item;
    expect(main.actions[0].id).toBe('send_draft');
    expect(main.more_actions.map((a) => a.id)).toContain('send_short');
    const drawer = projectDrawerItems(r.candidates, project.id, TZ).map((x) => x.item).find((i) => i.key === key)!;
    expect(drawer).toBeDefined();
    expect(drawer.actions).toEqual(main.actions);
    expect(drawer.more_actions).toEqual(main.more_actions);
    expect(drawer.owed_send).toEqual({ draft_id: 'g1', short_draft_id: 's1' });
  });

  it('with the switch off the drawer shows no Send', () => {
    const r = sel({ threads: [t], owed_rows: [drafted], owed_send: false });
    for (const x of projectDrawerItems(r.candidates, project.id, TZ)) expect(hasSend(x.item)).toBe(false);
  });

  it('step rows, bot tasks, the hands row, site rows, crisis mail and plain tasks never get a Send button', () => {
    const other = makeProject('Alpha site');
    const step: RawProjectStep = {
      project_id: other.id, project_name: other.name, client: makeClient('Alpha Co'), text: 'Mike, send Gene the proof.', source: 'bast',
      step_at: d('2026-11-09T12:00:00Z'), last_activity_at: d('2026-10-20T15:00:00Z'),
    };
    const bot = makeTask({ title: 'Bast stopped here', bot_task: true, client, project, tags: ['needs-mike'] });
    const hands = makeTask({ title: 'Rotate a key', tags: ['credential-rotation'], estimated_minutes: 10 });
    const plain = makeTask({ title: 'Own work', client, project, requested_by_contact_id: nextId(), clock_started_at: d('2026-11-01T15:00:00Z') });
    const incident: RawSiteIncident = {
      site_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', domain: 'jillscafe.com', client_id: client.id, client_name: client.name, source: 'kuma', ask_ids: [],
      started_at: new Date(TUE.getTime() - 35 * 60_000), last_checked_at: new Date(TUE.getTime() - 3 * 60_000), last_check_up: null, closed_at: null, close_reason: null, mail_links: [],
    };
    const r = sel({ threads: [t], owed_rows: [drafted], tasks: [bot, hands, plain], project_steps: [step], site_incidents: [incident] });
    const kinds = new Set(r.candidates.map((c) => c.kind));
    for (const k of ['step', 'task', 'hands', 'site', 'thread']) expect(kinds.has(k as never)).toBe(true);
    expect(r.candidates.some((c) => c.key === HANDS_ITEM_KEY)).toBe(true);
    expect(r.candidates.some((c) => c.key === siteItemKey('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))).toBe(true);
    for (const c of r.candidates) {
      if (c.kind === 'thread' && c.key === key) {
        expect(hasSend(c.item)).toBe(true);
      } else {
        expect(hasSend(c.item), `${c.kind} ${c.key}`).toBe(false);
        expect(c.item.owed_send ?? null).toBeNull();
      }
    }
    for (const x of projectDrawerItems(r.candidates, project.id, TZ)) {
      expect(x.item.key === key ? true : !hasSend(x.item)).toBe(true);
    }
  });

  it('homeActSchema still refuses send_draft and send_short', () => {
    for (const id of ['send_draft', 'send_short']) {
      expect(homeActSchema.safeParse({ action: id, item_key: key }).success).toBe(false);
      expect(homeActSchema.safeParse({ action: id, item_key: key, draft_id: 'g1' }).success).toBe(false);
    }
  });
});
