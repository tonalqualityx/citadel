/**
 * Hand-built fixture from the night of 2026-11-09 (plan H4): the Grok security task and its
 * arc of four open steps, the Claude sign-in task with a real date, the VCDP review fold of
 * 39 pieces, Jessica Everlith's and Andy Honeycutt's threads with drafts, the Stronghold
 * session ask, a jillscafe crisis mail and a collectiveyouth crisis mail.
 *
 * Also exports small builders (makeTask, makeAsk, ...) the other tests use. Builders never set
 * a field the contract leaves out; every Date is explicit.
 *
 * Dates are written as ISO strings; weekdays in expectations are computed from the date, never
 * assumed (2026-11-14 is a Saturday).
 */

import type {
  RawArcRef,
  RawCalendarEvent,
  RawClientRef,
  RawEmailAsk,
  RawHomeInputs,
  RawItemState,
  RawProjectRef,
  RawReviewFold,
  RawSessionAsk,
  RawTask,
  RawThread,
  RawWait,
} from '../../types';

export function uid(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

let counter = 1000;
export function nextId(): string {
  counter += 1;
  return uid(counter);
}

export const d = (iso: string): Date => new Date(iso);

// ---- Builders -------------------------------------------------------------

export function makeClient(name: string, over: Partial<RawClientRef> = {}): RawClientRef {
  return { id: nextId(), name, status: 'active', ...over };
}

export function makeProject(name: string, over: Partial<RawProjectRef> = {}): RawProjectRef {
  return { id: nextId(), name, status: 'in_progress', ...over };
}

export function makeArc(name: string, over: Partial<RawArcRef> = {}): RawArcRef {
  return { id: nextId(), name, client_id: null, project_id: null, closed_at: null, snoozed_until: null, ...over };
}

export function makeTask(over: Partial<RawTask> = {}): RawTask {
  return {
    id: nextId(),
    title: 'A task',
    description: null,
    status: 'not_started',
    tags: [],
    promised_to: null,
    hard_due_at: null,
    hard_due_source: null,
    created_by_id: null,
    due_date: null,
    created_at: d('2026-11-09T14:00:00Z'),
    clock_started_at: d('2026-11-09T14:00:00Z'),
    estimated_minutes: null,
    energy_estimate: null,
    mystery_factor: 'none',
    battery_impact: 'average_drain',
    client: null,
    project: null,
    site_id: null,
    charter_id: null,
    accord_id: null,
    billing_amount: null,
    requested_by_contact_id: null,
    requested_by_name: null,
    client_visible: false,
    open_blocking_count: 0,
    has_open_email_ask: false,
    arc: null,
    requirements: [],
    sop: null,
    origin_url: null,
    staging_preview_url: null,
    ...over,
  };
}

export function makeAsk(over: Partial<RawEmailAsk> = {}): RawEmailAsk {
  const id = nextId();
  return {
    id,
    message_id: `msg-${id}`,
    thread_id: `thr-${id}`,
    account: 'mike@becomeindelible.com',
    from_name: 'Pat Person',
    from_email: 'pat@example.com',
    subject: 'A question',
    gist: null,
    intent: 'general',
    is_urgent: false,
    state: 'open',
    client: null,
    project: null,
    task_id: null,
    arc_id: null,
    draft_url: null,
    draft_started_at: null,
    deep_link: `https://mail.google.com/mail/u/0/#all/${id}`,
    received_at: d('2026-11-05T15:00:00Z'),
    ...over,
  };
}

export function makeThread(over: Partial<RawEmailAsk> = {}, extraAsks: RawEmailAsk[] = []): RawThread {
  const ask = makeAsk(over);
  return { account: ask.account, thread_id: ask.thread_id ?? ask.message_id, asks: [ask, ...extraAsks] };
}

export function makeFold(over: Partial<RawReviewFold> = {}, pieces = 3): RawReviewFold {
  return {
    project: null,
    client: null,
    pieces: Array.from({ length: pieces }, (_, i) => ({
      id: nextId(),
      title: `Piece ${i + 1}`,
      completed_at: d('2026-11-01T15:00:00Z'),
    })),
    waiting_since: d('2026-11-01T15:00:00Z'),
    ...over,
  };
}

export function makeSession(over: Partial<RawSessionAsk> = {}): RawSessionAsk {
  const id = nextId();
  return {
    id,
    external_id: `sess-${id}`,
    title: null,
    waiting_on: 'Which option do you want?',
    ask_queue: 'decide',
    ask_severity: null,
    status: 'waiting',
    remote_url: 'https://claude.ai/code/session_x',
    asked_at: d('2026-11-04T15:00:00Z'),
    arc: null,
    client: null,
    project: null,
    ...over,
  };
}

export function makeWait(over: Partial<RawWait> = {}): RawWait {
  return {
    id: nextId(),
    kind: 'handoff',
    template_key: 'handoff.generic',
    state: 'waiting',
    title: 'A wait',
    detail: null,
    started_at: d('2026-11-01T15:00:00Z'),
    due_at: d('2026-11-30T22:00:00Z'),
    blocks_client: false,
    client_waiting_since: null,
    client: null,
    project: null,
    task_id: null,
    approval_request_id: null,
    charter_id: null,
    email_thread_id: null,
    email_account: null,
    ...over,
  };
}

export function makeState(item_key: string, over: Partial<RawItemState> = {}): RawItemState {
  return {
    item_key,
    park_count: 0,
    view_at: null,
    boosted_at: null,
    not_emergency_at: null,
    working_since: null,
    left_off_note: null,
    arc_added_at: null,
    arc_added_group: null,
    arc_removed_at: null,
    arc_removed_group: null,
    first_seen_at: d('2026-11-01T00:00:00Z'),
    last_shown_at: null,
    view_set_by: null,
    keeper_hold_until: null,
    read_hard_due_at: null,
    read_hard_due_source: null,
    dates_read_at: null,
    card_summary: null,
    card_checklist: null,
    card_summary_hash: null,
    card_summary_at: null,
    ...over,
  };
}

export function makeInputs(over: Partial<RawHomeInputs> = {}): RawHomeInputs {
  return {
    user_id: uid(1),
    now: d('2026-11-09T23:59:00Z'),
    tasks: [],
    review_folds: [],
    session_asks: [],
    waits: [],
    threads: [],
    crises: [],
    auto_handled: [],
    calendar_events: [],
    held_project_task_count: 0,
    held_projects: [],
    keeper_lines: [],
    ...over,
  };
}

// ---- Tonight --------------------------------------------------------------

export const NOW = d('2026-11-09T23:59:00Z'); // Monday 6:59 pm in New York

export const IDS = {
  grokClient: uid(11),
  northStar: uid(12),
  echoGrace: uid(13),
  vcdpClient: uid(14),
  trinityClient: uid(15),
  saiphClient: uid(16),
  grokProject: uid(21),
  vcdpProject: uid(22),
  grokArc: uid(31),
  tSignIn: uid(101),
  tGrokSecurity: uid(102),
  tGrokApprove: uid(103),
  tGrokPayment: uid(104),
  tGrokStripe: uid(105),
  tAee: uid(106),
  tSaiph: uid(107),
  crisisJills: uid(201),
  crisisYouth: uid(202),
  askJessica: uid(301),
  askAndy: uid(302),
  askMark: uid(303),
  askUptime: uid(304),
  waitIdle: uid(401),
} as const;

export function tonight(): { raw: RawHomeInputs; states: RawItemState[]; now: Date } {
  const grok: RawClientRef = { id: IDS.grokClient, name: 'Grok of the Rock', status: 'active' };
  const northStar: RawClientRef = { id: IDS.northStar, name: 'North Star Health', status: 'active' };
  const echo: RawClientRef = { id: IDS.echoGrace, name: 'Echo Grace Church', status: 'active' };
  const vcdp: RawClientRef = { id: IDS.vcdpClient, name: 'Valley Court Diversion Programs', status: 'active' };
  const trinity: RawClientRef = { id: IDS.trinityClient, name: 'Trinity Industries', status: 'active' };
  const saiph: RawClientRef = { id: IDS.saiphClient, name: 'Saiph Grants', status: 'active' };
  const grokProject: RawProjectRef = { id: IDS.grokProject, name: 'Grok of the Rock', status: 'in_progress' };
  const vcdpProject: RawProjectRef = { id: IDS.vcdpProject, name: 'VCDP', status: 'in_progress' };
  const arc: RawArcRef = {
    id: IDS.grokArc,
    name: "Grok of the Rock: Gene's asks",
    client_id: IDS.grokClient,
    project_id: IDS.grokProject,
    closed_at: null,
    snoozed_until: null,
  };

  const tasks: RawTask[] = [
    makeTask({
      id: IDS.tSignIn,
      title: 'Install the long-lived Claude sign-in on the Bast machine before Friday',
      description: JSON.stringify([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The sign-in ends between November 16 and 19 — install a long-lived token once so the scheduled jobs keep running.',
              styles: {},
            },
          ],
        },
      ]),
      tags: ['job-watch', 'job-watch:claude-signin'],
      due_date: d('2026-11-14T00:00:00.000Z'), // a Saturday, stored as a date-only value
      created_at: d('2026-11-09T20:00:00Z'),
      clock_started_at: d('2026-11-09T20:00:00Z'),
      estimated_minutes: 10,
    }),
    makeTask({
      id: IDS.tGrokSecurity,
      title: "Grok of the Rock — a hidden link to ki-system.org sits in the live site's footer",
      tags: ['security'],
      client: grok,
      project: grokProject,
      site_id: uid(41),
      arc,
      requested_by_contact_id: uid(51),
      requested_by_name: 'Gene Roberts',
      created_at: d('2026-10-27T15:00:00Z'),
      clock_started_at: d('2026-10-27T15:00:00Z'),
      estimated_minutes: 40,
      requirements: [
        { text: 'Link removed from the live footer', completed: false },
        { text: 'Site scanned and admin users checked', completed: false },
        { text: 'Gene told what was found', completed: false },
      ],
      sop: { id: uid(61), title: 'WordPress compromise runbook' },
    }),
    makeTask({
      id: IDS.tGrokApprove,
      title: 'Grok of the Rock: approve the built site on the preview',
      status: 'blocked',
      client: grok,
      project: grokProject,
      arc,
      requested_by_contact_id: uid(51),
      requested_by_name: 'Gene Roberts',
      created_at: d('2026-10-25T15:00:00Z'),
      clock_started_at: d('2026-10-25T15:00:00Z'),
      estimated_minutes: 20,
      staging_preview_url: 'https://grok.pages.dev',
    }),
    makeTask({
      id: IDS.tGrokPayment,
      title: "Grok of the Rock: set up Gene's recurring hosting payment",
      client: grok,
      project: grokProject,
      arc,
      requested_by_contact_id: uid(51),
      requested_by_name: 'Gene Roberts',
      created_at: d('2026-09-21T15:00:00Z'),
      clock_started_at: d('2026-09-21T15:00:00Z'),
      estimated_minutes: 30,
    }),
    makeTask({
      id: IDS.tGrokStripe,
      title: 'Grok of the Rock: walk Gene through Stripe',
      client: grok,
      project: grokProject,
      arc,
      requested_by_contact_id: uid(51),
      requested_by_name: 'Gene Roberts',
      created_at: d('2026-10-20T15:00:00Z'),
      clock_started_at: d('2026-10-20T15:00:00Z'),
      estimated_minutes: 30,
    }),
    makeTask({
      id: IDS.tAee,
      title: 'Turn off auto-renew on aee-socal.org',
      created_at: d('2026-11-02T15:00:00Z'),
      clock_started_at: d('2026-11-02T15:00:00Z'),
      estimated_minutes: 10,
    }),
    makeTask({
      id: IDS.tSaiph,
      title: 'Review the grant calendar',
      client: saiph,
      created_at: d('2026-10-01T15:00:00Z'),
      clock_started_at: d('2026-10-01T15:00:00Z'),
    }),
  ];

  const fold: RawReviewFold = {
    project: vcdpProject,
    client: vcdp,
    pieces: Array.from({ length: 39 }, (_, i) => ({
      id: uid(1000 + i),
      title: `VCDP piece ${i + 1}`,
      completed_at: d('2026-10-27T15:00:00Z'),
    })),
    waiting_since: d('2026-10-27T15:00:00Z'),
  };

  const session: RawSessionAsk = {
    id: uid(71),
    external_id: 'stronghold-store-answers',
    title: 'Stronghold Stuff',
    waiting_on: 'Accept the 15 rewrite fixes and answer three store questions: charge timing, mixed shipping, guest checkout.',
    ask_queue: 'decide',
    ask_severity: 'internal',
    status: 'waiting',
    remote_url: 'https://claude.ai/code/session_stronghold',
    asked_at: d('2026-11-04T15:00:00Z'),
    arc: null,
    client: trinity,
    project: null,
  };

  const jessica = makeAsk({
    id: IDS.askJessica,
    thread_id: 'thr-jessica',
    from_name: 'Jessica Everlith',
    from_email: 'jessica@northstarhealth.example',
    subject: 'Re: Checking In',
    gist: 'She wants to talk and see what you came up with',
    intent: 'sales',
    client: northStar,
    draft_url: 'https://mail.google.com/mail/u/0/#drafts/jessica',
    received_at: d('2026-10-30T15:00:00Z'),
  });
  const andy = makeAsk({
    id: IDS.askAndy,
    thread_id: 'thr-andy',
    from_name: 'Andy Honeycutt',
    from_email: 'andy@echograce.example',
    subject: 'Meeting?',
    gist: 'He asked for an update on the training site',
    client: echo,
    draft_url: 'https://mail.google.com/mail/u/0/#drafts/andy',
    received_at: d('2026-10-20T15:00:00Z'),
  });
  const mark = makeAsk({
    id: IDS.askMark,
    thread_id: 'thr-mark',
    from_name: 'Mark Mitchell',
    from_email: 'mark@mitchs.example',
    subject: 'Holiday ads',
    client: echo,
    received_at: d('2026-10-10T15:00:00Z'), // 30 days old: an older open thread
  });
  const uptime = makeAsk({
    id: IDS.askUptime,
    thread_id: 'thr-uptime',
    from_name: 'WPMU DEV',
    from_email: 'noreply@wpmudev.example',
    subject: 'Your site report',
    client: echo,
    received_at: d('2026-11-03T15:00:00Z'),
  });

  const crises = [
    makeAsk({
      id: IDS.crisisJills,
      thread_id: 'thr-jills',
      from_name: 'Uptime monitor',
      from_email: 'alerts@monitor.example',
      subject: 'jillscafe.net is down',
      is_urgent: true,
      received_at: d('2026-11-09T21:00:00Z'),
    }),
    makeAsk({
      id: IDS.crisisYouth,
      thread_id: 'thr-youth',
      from_name: 'Uptime monitor',
      from_email: 'alerts@collectiveyouth.com',
      subject: 'collectiveyouth.com is down',
      is_urgent: true,
      received_at: d('2026-11-09T22:00:00Z'),
    }),
  ];

  const events: RawCalendarEvent[] = [
    { id: 'ev1', title: 'Call', starts_at: d('2026-11-09T20:00:00Z'), ends_at: d('2026-11-09T20:30:00Z'), all_day: false },
  ];

  const raw = makeInputs({
    user_id: uid(1),
    now: NOW,
    tasks,
    review_folds: [fold],
    session_asks: [session],
    waits: [makeWait({ id: IDS.waitIdle })],
    threads: [
      { account: jessica.account, thread_id: 'thr-jessica', asks: [jessica] },
      { account: andy.account, thread_id: 'thr-andy', asks: [andy] },
      { account: mark.account, thread_id: 'thr-mark', asks: [mark] },
      { account: uptime.account, thread_id: 'thr-uptime', asks: [uptime] },
    ],
    crises,
    auto_handled: [],
    calendar_events: events,
    held_project_task_count: 213,
  });
  return { raw, states: [], now: NOW };
}
