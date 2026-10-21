/**
 * Every clock in the maps, as data (specs/citadel-shape-SPEC.md section 2.9). A template is
 * never a table: adding or changing a clock is a change to this file.
 *
 * Phase 1 sends nothing. Only the templates flagged `enabled: true` can be opened; the rest
 * are registered so their shape is reviewed once, and `buildWaitData` refuses them until a
 * later phase turns them on behind their switch. The sales numbers are Bast's dormancy
 * proposal (tracker section 9) as constants, so a different ruling is a one-line change.
 */

import { computeDueAt, type WaitUnitName } from './business-days';

export type WaitKindName = 'approval' | 'clock' | 'handoff' | 'meeting' | 'external' | 'switch';
export type WaitActionName = 'proceed' | 'send' | 'escalate' | 'task';

/** Roles resolve through lib/waits/owner.ts. `client` waits are owed by a client contact. */
export type RoleKey =
  | 'mike'
  | 'pm'
  | 'design'
  | 'content'
  | 'liaison'
  | 'wordpress'
  | 'billing'
  | 'social'
  | 'sales'
  | 'bast'
  | 'client'
  | 'switch_owner';

export type GuardKey = 'review_clock_on' | 'silent_acceptance_live';

/**
 * Per-client toggles (spec 3.11). Their columns land in phase 3; until then a missing value
 * means the default Mike left open and Bast picked: silence counts as acceptance for
 * pre-launch reviews and plans, and never for a change to a live site.
 */
export const GUARD_DEFAULTS: Record<GuardKey, boolean> = {
  review_clock_on: true,
  silent_acceptance_live: false,
};

export type GuardValues = Partial<Record<GuardKey, boolean | null | undefined>>;

export function guardPasses(guard: GuardKey, values?: GuardValues): boolean {
  const v = values?.[guard];
  return typeof v === 'boolean' ? v : GUARD_DEFAULTS[guard];
}

export interface StepDuration {
  value: number;
  unit: WaitUnitName;
}

export interface TemplateStep {
  /** Time from the previous step (or from the wait's start for step 1). */
  duration: StepDuration;
  action: WaitActionName;
  /** What happens when it runs out, in plain words. Shown on the wait and in the flags view. */
  note: string;
  /** When set and the guard fails, `fallback` runs instead of `action`. */
  guard?: GuardKey;
  fallback?: WaitActionName;
  /** Overrides for this step only. */
  owner?: RoleKey;
  kind?: WaitKindName;
  blocks_client?: boolean;
  /** Merged into action_payload. */
  payload?: Record<string, unknown>;
}

export interface WaitTemplate {
  key: string;
  kind: WaitKindName;
  /** false = registered only. Phase 1 opens no template that sends. */
  enabled: boolean;
  /** Any step sends mail. Sends go to the machine outbox and stay behind a switch. */
  sends: boolean;
  owner: RoleKey;
  /** For client-owned waits: the internal role that acts when the clock fires. */
  shepherd?: RoleKey;
  blocks_client: boolean;
  /** Pattern for the standalone action line. `{subject}` is filled by the caller. */
  title: string;
  steps: TemplateStep[];
  /** The caller gives due_at (it comes from a date, not from a duration). */
  fixed_due?: boolean;
  /** The caller may set the duration (handoff.generic only). */
  caller_duration?: boolean;
  /** Skip firing when this holds at the moment it runs out. */
  precondition?: 'no_charter' | 'no_plan' | 'portal_answered';
  /** What an inbound reply does to the open wait (W6 reads this). */
  on_reply: 'stop' | 'needs_human' | null;
  /** Switch that holds the sends back while OFF. */
  switch_key?: string;
  /** The row in the spec's table, for the reviewer. */
  spec: string;
}

const bd = (value: number): StepDuration => ({ value, unit: 'business_days' });
const cd = (value: number): StepDuration => ({ value, unit: 'calendar_days' });
const hrs = (value: number): StepDuration => ({ value, unit: 'hours' });

const SEND_SWITCH = 'WAIT_SENDERS';

export const WAIT_TEMPLATES: WaitTemplate[] = [
  // ----- Sales -----
  {
    key: 'sales.proposal_review',
    kind: 'approval',
    enabled: false,
    sends: false,
    owner: 'sales',
    blocks_client: true,
    title: 'Review and send {subject}',
    steps: [{ duration: bd(2), action: 'escalate', note: 'Climb the ladder: role holder, then the PM, then Mike.' }],
    on_reply: 'stop',
    spec: 'sales.proposal_review | approval | sales | 2 bd | ladder | yes',
  },
  {
    key: 'sales.proposal_unopened',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'sales',
    blocks_client: false,
    title: 'Resend {subject}, which was never opened',
    steps: [{ duration: bd(3), action: 'send', note: 'Send the unopened-proposal resend.' }],
    on_reply: 'stop',
    switch_key: SEND_SWITCH,
    spec: 'sales.proposal_unopened | clock | sales | 3 bd | send resend | no',
  },
  {
    key: 'sales.proposal_no_action',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'sales',
    blocks_client: false,
    title: 'Follow up on {subject} after the client viewed the proposal',
    steps: [
      { duration: bd(5), action: 'send', note: 'Send the follow-up five business days after the visit.' },
      { duration: bd(5), action: 'send', note: 'Send one more follow-up five business days later.' },
    ],
    on_reply: 'stop',
    switch_key: SEND_SWITCH,
    spec: 'sales.proposal_no_action | clock | sales | 5 bd from visit, then +5 | send follow-up, then one more | no',
  },
  {
    key: 'sales.proposal_closing',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'sales',
    blocks_client: false,
    title: 'Send the closing note on {subject}',
    steps: [{ duration: bd(15), action: 'send', note: 'Send the closing note 15 business days after the proposal went out.' }],
    on_reply: 'stop',
    switch_key: SEND_SWITCH,
    spec: 'sales.proposal_closing | clock | sales | 15 bd from send | send closing note | no',
  },
  {
    key: 'sales.proposal_call',
    kind: 'handoff',
    enabled: false,
    sends: false,
    owner: 'sales',
    blocks_client: false,
    title: 'Phone the client about {subject} using the 30-second script',
    steps: [{ duration: bd(10), action: 'task', note: 'Open a task: phone call with the 30-second script.' }],
    on_reply: 'stop',
    spec: 'sales.proposal_call | handoff | sales | 10 bd | task: phone call, 30-second script | no',
  },
  {
    key: 'sales.proposal_dormant',
    kind: 'clock',
    enabled: false,
    sends: false,
    owner: 'sales',
    blocks_client: false,
    title: 'Mark {subject} dormant',
    steps: [
      {
        duration: bd(30),
        action: 'proceed',
        note: 'Mark the lead dormant and set a retouch date 60 days out.',
        payload: { effect: 'accord_dormant', retouch_days: 60 },
      },
    ],
    on_reply: 'stop',
    spec: 'sales.proposal_dormant | clock | sales | 30 bd from send | proceed: dormant, retouch at 60 days | no',
  },
  {
    key: 'sales.audit_unopened',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'sales',
    blocks_client: false,
    title: 'Resend the audit report to {subject}, unopened after two days',
    steps: [{ duration: hrs(48), action: 'send', note: 'Resend the audit once, 48 hours after it went out unopened.' }],
    on_reply: 'stop',
    switch_key: SEND_SWITCH,
    spec: 'sales.audit_unopened | clock | sales | 48 hours | send resend once | no',
  },
  {
    key: 'sales.audit_no_booking',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'sales',
    blocks_client: false,
    title: 'Follow up with {subject}, who viewed the audit and has not booked',
    steps: [{ duration: cd(7), action: 'send', note: 'Send the follow-up seven days after the visit.' }],
    on_reply: 'stop',
    switch_key: SEND_SWITCH,
    spec: 'sales.audit_no_booking | clock | sales | 7 days from visit | send follow-up | no',
  },
  {
    key: 'sales.audit_closing',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'sales',
    blocks_client: false,
    title: 'Send the closing note to {subject} after the audit',
    steps: [{ duration: cd(21), action: 'send', note: 'Send the closing note 21 days after the visit.' }],
    on_reply: 'stop',
    switch_key: SEND_SWITCH,
    spec: 'sales.audit_closing | clock | sales | 21 days from visit | send closing note | no',
  },
  {
    key: 'sales.lead_dormant',
    kind: 'clock',
    enabled: false,
    sends: false,
    owner: 'sales',
    blocks_client: false,
    title: 'Mark the lead {subject} dormant',
    steps: [
      {
        duration: cd(30),
        action: 'proceed',
        note: 'Mark the lead dormant and set a quarterly check-in.',
        payload: { effect: 'accord_dormant', retouch_days: 90 },
      },
    ],
    on_reply: 'stop',
    spec: 'sales.lead_dormant | clock | sales | 30 days from visit | proceed: dormant, quarterly check-in | no',
  },

  // ----- Onboarding and build -----
  {
    key: 'onboarding.missing_items',
    kind: 'external',
    enabled: false,
    sends: true,
    owner: 'client',
    shepherd: 'pm',
    blocks_client: false,
    title: 'Collect the missing onboarding items from {subject}',
    steps: [
      { duration: bd(3), action: 'send', note: 'Send the missing-items nudge after three business days.' },
      { duration: bd(4), action: 'task', owner: 'pm', note: 'Open a task for the PM at seven business days.' },
    ],
    on_reply: 'needs_human',
    switch_key: SEND_SWITCH,
    spec: 'onboarding.missing_items | external | client; PM | 3 bd, 7 bd | send nudges, then task to PM | no',
  },
  {
    key: 'build.gate_mike',
    kind: 'approval',
    enabled: true,
    sends: false,
    owner: 'mike',
    blocks_client: true,
    title: 'Approve {subject}',
    steps: [{ duration: bd(2), action: 'escalate', note: 'Mike is the owner, so this only climbs in visibility.' }],
    on_reply: null,
    spec: 'build.gate_mike | approval | Mike | 2 bd | ladder | yes',
  },
  {
    key: 'build.review_internal',
    kind: 'approval',
    enabled: true,
    sends: false,
    owner: 'content',
    blocks_client: true,
    title: 'Review {subject}',
    steps: [{ duration: bd(2), action: 'escalate', note: 'Escalate: role holder, then the PM, then Mike.' }],
    on_reply: null,
    spec: 'build.review_internal | approval | content, pm or design | 2 bd | escalate | yes',
  },
  {
    key: 'build.review_client',
    kind: 'approval',
    enabled: false,
    sends: false,
    owner: 'client',
    shepherd: 'liaison',
    blocks_client: false,
    title: 'Get the client review of {subject}',
    steps: [
      {
        duration: bd(10),
        action: 'proceed',
        guard: 'review_clock_on',
        fallback: 'task',
        owner: 'pm',
        note: 'Accept on silence when the client review clock is on; otherwise open a task for the PM.',
        payload: { effect: 'accept_on_silence' },
      },
    ],
    on_reply: 'needs_human',
    spec: 'build.review_client | approval | client; liaison | 10 bd | proceed if review clock on, else task to PM | no',
  },
  {
    key: 'build.kickoff_booking',
    kind: 'meeting',
    enabled: false,
    sends: true,
    owner: 'client',
    shepherd: 'liaison',
    blocks_client: false,
    title: 'Book the kickoff meeting with {subject}',
    steps: [
      { duration: bd(5), action: 'send', note: 'Send the kickoff-booking reminder after five business days.' },
      { duration: bd(3), action: 'task', owner: 'liaison', note: 'Then open a task for the liaison (3 business days later, a default).' },
    ],
    on_reply: 'stop',
    switch_key: SEND_SWITCH,
    spec: 'build.kickoff_booking | meeting | client; liaison | 5 bd | send reminder, then task to liaison | no',
  },
  {
    key: 'build.case_study_consent',
    kind: 'approval',
    enabled: false,
    sends: false,
    owner: 'client',
    shepherd: 'liaison',
    blocks_client: false,
    title: 'Record case-study consent from {subject}',
    steps: [
      {
        duration: bd(10),
        action: 'proceed',
        note: 'Record no consent after ten business days of silence.',
        payload: { effect: 'case_study_consent_no' },
      },
    ],
    on_reply: 'needs_human',
    spec: 'build.case_study_consent | approval | client | 10 bd | proceed: no consent | no',
  },
  {
    key: 'launch.d90',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'liaison',
    blocks_client: false,
    title: 'Send the 90-day check-in to {subject}',
    steps: [{ duration: cd(90), action: 'send', note: 'Send the 90-day email, unless a charter exists by then.' }],
    precondition: 'no_charter',
    on_reply: null,
    switch_key: SEND_SWITCH,
    spec: 'launch.d90 | clock | liaison | 90 days | send unless a charter exists | no',
  },

  // ----- Change requests and marketing -----
  {
    key: 'change.staged_live',
    kind: 'approval',
    enabled: false,
    sends: true,
    owner: 'client',
    shepherd: 'liaison',
    blocks_client: false,
    title: 'Get the client yes on the staged change {subject}',
    steps: [
      { duration: bd(5), action: 'send', note: 'Send the nudge after five business days.' },
      {
        duration: bd(5),
        action: 'proceed',
        guard: 'silent_acceptance_live',
        fallback: 'task',
        owner: 'liaison',
        note: 'Publish only if the client allows silent acceptance on live changes; otherwise open a task for the liaison.',
        payload: { effect: 'publish_staged_change' },
      },
    ],
    on_reply: 'needs_human',
    switch_key: SEND_SWITCH,
    spec: 'change.staged_live | approval | client; liaison | 5 bd, 10 bd | send nudge; publish only if silent_acceptance_live, else task to liaison | no',
  },
  {
    key: 'change.needs_human',
    kind: 'handoff',
    enabled: true,
    sends: false,
    owner: 'wordpress',
    blocks_client: true,
    title: 'Take over the change request {subject} that the machine could not finish',
    steps: [{ duration: bd(2), action: 'escalate', note: 'Escalate: role holder, then the PM, then Mike.' }],
    on_reply: null,
    spec: 'change.needs_human | handoff | role by platform | 2 bd | escalate | yes',
  },
  {
    key: 'marketing.plan_approval',
    kind: 'approval',
    enabled: false,
    sends: true,
    owner: 'client',
    shepherd: 'pm',
    blocks_client: false,
    title: 'Get the client yes on the marketing plan {subject}',
    steps: [
      { duration: bd(5), action: 'send', note: 'Send the reminder after five business days.' },
      {
        duration: bd(5),
        action: 'proceed',
        guard: 'review_clock_on',
        fallback: 'task',
        owner: 'pm',
        note: 'Accept the plan on silence when the review clock is on; otherwise open a task for the PM.',
        payload: { effect: 'accept_on_silence' },
      },
    ],
    on_reply: 'needs_human',
    switch_key: SEND_SWITCH,
    spec: 'marketing.plan_approval | approval | client; PM | 5 bd, 10 bd | send reminder; proceed if toggle on, else task to PM | no',
  },
  {
    key: 'marketing.horizon',
    kind: 'clock',
    enabled: false,
    sends: false,
    owner: 'pm',
    blocks_client: false,
    title: 'Draft the next marketing plan for {subject}',
    steps: [{ duration: cd(21), action: 'task', note: 'Open a task for the PM if no plan exists 21 days before the period.' }],
    fixed_due: true,
    precondition: 'no_plan',
    on_reply: null,
    spec: 'marketing.horizon | clock | PM | 21 days before period | task to PM if no plan | no',
  },

  // ----- Money, charters, maintenance -----
  {
    key: 'money.invoice',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'billing',
    blocks_client: false,
    title: 'Collect the unpaid invoice {subject}',
    steps: [
      { duration: cd(30), action: 'send', note: 'Day 30: send the payment reminder.' },
      { duration: cd(15), action: 'send', note: 'Day 45: send the warning.' },
      {
        duration: cd(15),
        action: 'task',
        owner: 'pm',
        note: 'Day 60: pause the client, send the pay link, and open a task for the PM.',
        payload: { effect: 'pause_client', pay_link: true },
      },
      {
        duration: cd(25),
        action: 'escalate',
        owner: 'mike',
        kind: 'approval',
        note: 'Day 85: Mike decides, with the hold page five days away.',
        payload: { title: 'Decide on the hold page for the unpaid invoice {subject} in 5 days' },
      },
      {
        duration: cd(5),
        action: 'proceed',
        note: 'Day 90: put up the hold page.',
        payload: { effect: 'hold_page' },
      },
    ],
    on_reply: null,
    switch_key: SEND_SWITCH,
    spec: 'money.invoice | clock | billing | 30, 45, 60, 85, 90 days | reminder; warning; pause + pay link + PM; Mike wait "hold page in 5 days"; hold page | no',
  },
  {
    key: 'charter.price_review',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'bast',
    blocks_client: false,
    title: 'Review the price of the charter {subject}',
    steps: [
      { duration: cd(14), action: 'task', note: 'Fourteen days before the review date, open a task to draft the price note.' },
      { duration: bd(3), action: 'escalate', owner: 'mike', kind: 'approval', note: 'Mike approves the draft within three business days.' },
      { duration: hrs(0), action: 'send', note: 'Send the approved price note.' },
      { duration: hrs(0), action: 'proceed', note: 'Stamp the review done.', payload: { effect: 'price_review_done' } },
    ],
    fixed_due: true,
    on_reply: null,
    switch_key: SEND_SWITCH,
    spec: 'charter.price_review | clock | Bast, then Mike | 14 days before date | task to draft; Mike approval 3 bd; send; stamp done | no',
  },
  {
    key: 'charter.renewal',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'pm',
    blocks_client: false,
    title: 'Send the renewal note for {subject}',
    steps: [{ duration: cd(30), action: 'send', note: 'Send the renewal note 30 days before the term ends.' }],
    fixed_due: true,
    on_reply: null,
    switch_key: SEND_SWITCH,
    spec: 'charter.renewal | clock | PM | 30 days before term end | send renewal note | no',
  },
  {
    key: 'wp.failed_update',
    kind: 'handoff',
    enabled: false,
    sends: false,
    owner: 'wordpress',
    blocks_client: false,
    title: 'Fix the failed WordPress update on {subject}',
    steps: [
      {
        duration: bd(5),
        action: 'escalate',
        note: 'Escalate straight to Mike after five business days.',
        payload: { escalate_to: 'mike' },
      },
    ],
    on_reply: null,
    spec: 'wp.failed_update | handoff | wordpress | 5 bd | escalate to Mike | no',
  },
  {
    key: 'maint.report_monthly',
    kind: 'clock',
    enabled: false,
    sends: true,
    owner: 'billing',
    blocks_client: false,
    title: 'Send the monthly report for {subject}',
    steps: [{ duration: cd(0), action: 'send', note: 'Send the report on the 1st.' }],
    fixed_due: true,
    on_reply: null,
    switch_key: SEND_SWITCH,
    spec: 'maint.report_monthly | clock | billing | the 1st | send report | no',
  },
  {
    key: 'incident.after_action',
    kind: 'handoff',
    enabled: false,
    sends: false,
    owner: 'mike',
    blocks_client: false,
    title: 'Write the after-action note for {subject}',
    steps: [{ duration: bd(2), action: 'escalate', note: 'Mike owns it, so this only climbs in visibility.' }],
    on_reply: null,
    spec: 'incident.after_action | handoff | Mike | 2 bd after resolve | ladder | no',
  },

  // ----- Client portal (phase B) -----
  {
    key: 'portal.first_response',
    kind: 'handoff',
    enabled: true,
    sends: false,
    owner: 'bast',
    blocks_client: true,
    title: 'Answer the client request {subject}',
    steps: [{ duration: bd(1), action: 'escalate', note: 'Climb the ladder when nobody has answered the client.' }],
    precondition: 'portal_answered',
    on_reply: null,
    spec: 'portal.first_response | handoff | caller sets, bast by default | 1 bd | escalate; skipped by portal_answered | yes',
  },
  {
    key: 'portal.emergency',
    kind: 'handoff',
    enabled: true,
    sends: false,
    owner: 'mike',
    blocks_client: true,
    title: 'Respond to the urgent client request {subject}',
    steps: [{ duration: hrs(2), action: 'escalate', note: 'Mike owns it; running out puts it in front of him.' }],
    on_reply: null,
    spec: 'portal.emergency | handoff | Mike | 2 hours | escalate (visibility for Mike) | yes',
  },

  // ----- Meetings, switches, generic -----
  {
    key: 'meeting.type_unclear',
    kind: 'handoff',
    enabled: true,
    sends: false,
    owner: 'mike',
    blocks_client: false,
    title: 'Say what kind of meeting {subject} is',
    steps: [{ duration: bd(1), action: 'escalate', note: 'Mike owns it; it is asked about in the ritual.' }],
    on_reply: null,
    spec: 'meeting.type_unclear | handoff | Mike | 1 bd | ladder; asked in the ritual | no',
  },
  {
    key: 'switch.off',
    kind: 'switch',
    enabled: true,
    sends: false,
    owner: 'switch_owner',
    blocks_client: false,
    title: 'Turn on the switch {subject} or confirm the switch stays off',
    steps: [{ duration: cd(7), action: 'escalate', note: 'Stays until the switch is flipped; reminds weekly.' }],
    on_reply: null,
    spec: 'switch.off | switch | switch owner | weekly | stays until flipped | if it blocks a client wait',
  },
  {
    key: 'handoff.generic',
    kind: 'handoff',
    enabled: true,
    sends: false,
    owner: 'mike',
    blocks_client: false,
    title: '{subject}',
    steps: [{ duration: bd(2), action: 'escalate', note: 'Climb the ladder when it runs out.' }],
    caller_duration: true,
    on_reply: null,
    spec: 'phase 1 addition: a plain handoff with a dated clock, for the backfill and for hand-opened waits',
  },
];

const BY_KEY = new Map(WAIT_TEMPLATES.map((t) => [t.key, t]));

export function getTemplate(key: string): WaitTemplate | undefined {
  return BY_KEY.get(key);
}

export function listTemplates(): WaitTemplate[] {
  return WAIT_TEMPLATES;
}

export function liveTemplateKeys(): string[] {
  return WAIT_TEMPLATES.filter((t) => t.enabled).map((t) => t.key);
}

export class TemplateError extends Error {
  constructor(
    message: string,
    public code: 'unknown_template' | 'template_disabled' | 'missing_due_at' | 'bad_input'
  ) {
    super(message);
    this.name = 'TemplateError';
  }
}

export function renderTitle(pattern: string, subject?: string): string {
  const s = (subject ?? '').trim();
  return pattern.replace(/\{subject\}/g, s).replace(/\s+/g, ' ').trim();
}

export function stepFor(template: WaitTemplate, step: number): TemplateStep | undefined {
  return template.steps[step - 1];
}

export interface WaitInput {
  template_key: string;
  /** Names what the wait is about; fills the title pattern. */
  subject?: string;
  /** Overrides the rendered title entirely. Must stand alone. */
  title?: string;
  detail?: string | null;
  step?: number;
  started_at?: Date;
  /** Required for `fixed_due` templates. */
  due_at?: Date;
  /** Only honored for `caller_duration` templates. */
  duration?: StepDuration;
  /** Owner overrides; empty means the template's role resolves (and Mike behind it). */
  owner_function_id?: string | null;
  owner_user_id?: string | null;
  owner_contact_id?: string | null;
  client_id?: string | null;
  accord_id?: string | null;
  project_id?: string | null;
  charter_id?: string | null;
  site_id?: string | null;
  task_id?: string | null;
  arc_id?: string | null;
  approval_request_id?: string | null;
  email_thread_id?: string | null;
  email_account?: string | null;
  client_waiting_since?: Date | null;
  blocks_client?: boolean;
  action_payload?: Record<string, unknown> | null;
  created_by_id?: string | null;
  created_by_automation?: string | null;
  idempotency_key?: string | null;
}

/**
 * Keys a caller may put in action_payload. Everything that shapes what the sweeper DOES
 * (guard, fallback, effect, escalate_to, owner_role, shepherd_role, switch_owner_user_id,
 * pay_link, retouch_days, ...) comes from the template alone; the sweeper reads the template,
 * not the payload, for the action. This allowlist is the second lock.
 */
export const CALLER_PAYLOAD_KEYS = ['note', 'context', 'reference', 'from_wait_id'] as const;

export function sanitizeCallerPayload(input: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of CALLER_PAYLOAD_KEYS) {
    const v = input[k];
    if (typeof v === 'string') out[k] = v.slice(0, 500);
  }
  return out;
}

/** Plain columns for a new Wait row. Pure: no database. Throws TemplateError. */
export function buildWaitData(input: WaitInput, opts: { allowDisabled?: boolean } = {}) {
  const template = getTemplate(input.template_key);
  if (!template) throw new TemplateError(`Unknown wait template: ${input.template_key}`, 'unknown_template');
  if (!template.enabled && !opts.allowDisabled) {
    throw new TemplateError(
      `Wait template ${input.template_key} is registered but disabled in phase 1.`,
      'template_disabled'
    );
  }
  const stepNo = input.step ?? 1;
  const step = stepFor(template, stepNo);
  if (!step) throw new TemplateError(`Template ${template.key} has no step ${stepNo}.`, 'bad_input');

  const started_at = input.started_at ?? new Date();
  let duration: StepDuration = step.duration;
  if (template.caller_duration && input.duration) duration = input.duration;

  let due_at: Date;
  if (input.due_at) {
    due_at = input.due_at;
  } else if (template.fixed_due && stepNo === 1) {
    throw new TemplateError(`Template ${template.key} needs a due_at (its clock comes from a date).`, 'missing_due_at');
  } else {
    due_at = computeDueAt(started_at, duration.value, duration.unit);
  }

  const pattern = step.payload?.title ? String(step.payload.title) : template.title;
  const title = (input.title ?? renderTitle(pattern, input.subject)).slice(0, 300);
  if (!title) throw new TemplateError('A wait needs a title or a subject.', 'bad_input');

  const blocks_client = input.blocks_client ?? step.blocks_client ?? template.blocks_client;
  const payload: Record<string, unknown> = {
    ...(step.payload ?? {}),
    ...sanitizeCallerPayload(input.action_payload),
    owner_role: step.owner ?? template.owner,
  };
  if (template.shepherd) payload.shepherd_role = template.shepherd;
  if (step.guard) payload.guard = step.guard;
  if (step.fallback) payload.fallback = step.fallback;
  delete payload.title;
  if (input.subject) payload.subject = input.subject;

  return {
    kind: step.kind ?? template.kind,
    template_key: template.key,
    step: stepNo,
    title,
    detail: input.detail ?? null,
    owner_function_id: input.owner_function_id ?? null,
    owner_user_id: input.owner_user_id ?? null,
    owner_contact_id: input.owner_contact_id ?? null,
    client_id: input.client_id ?? null,
    accord_id: input.accord_id ?? null,
    project_id: input.project_id ?? null,
    charter_id: input.charter_id ?? null,
    site_id: input.site_id ?? null,
    task_id: input.task_id ?? null,
    arc_id: input.arc_id ?? null,
    approval_request_id: input.approval_request_id ?? null,
    email_thread_id: input.email_thread_id ?? null,
    email_account: input.email_account ?? null,
    started_at,
    duration_value: duration.value,
    duration_unit: duration.unit,
    due_at,
    blocks_client,
    client_waiting_since: input.client_waiting_since ?? (blocks_client ? started_at : null),
    terminal_action: step.action,
    action_payload: payload,
    created_by_id: input.created_by_id ?? null,
    created_by_automation: input.created_by_automation ?? null,
    idempotency_key: input.idempotency_key ?? null,
  };
}

/**
 * The next step of a chain, started `now`. Null when the chain is finished. The caller stores
 * it under the key `<wait id>:next`, which makes opening it idempotent.
 */
export function buildNextStepData(
  prev: {
    id: string;
    template_key: string;
    step: number;
    title: string;
    detail: string | null;
    owner_function_id: string | null;
    owner_user_id: string | null;
    owner_contact_id: string | null;
    client_id: string | null;
    accord_id: string | null;
    project_id: string | null;
    charter_id: string | null;
    site_id: string | null;
    task_id: string | null;
    arc_id: string | null;
    approval_request_id: string | null;
    email_thread_id: string | null;
    email_account: string | null;
    blocks_client: boolean;
    client_waiting_since: Date | null;
    action_payload: unknown;
  },
  now: Date
) {
  const template = getTemplate(prev.template_key);
  if (!template) return null;
  const nextNo = prev.step + 1;
  const step = stepFor(template, nextNo);
  if (!step) return null;
  const prevPayload = (prev.action_payload && typeof prev.action_payload === 'object'
    ? (prev.action_payload as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const subject = typeof prevPayload.subject === 'string' ? prevPayload.subject : undefined;
  const title = step.payload?.title ? renderTitle(String(step.payload.title), subject) : prev.title;
  // A step with its own owner role drops the person and role the earlier step carried.
  const ownerChanged = !!step.owner;
  return buildWaitData(
    {
      template_key: template.key,
      step: nextNo,
      title,
      subject,
      detail: prev.detail,
      started_at: now,
      owner_function_id: ownerChanged ? null : prev.owner_function_id,
      owner_user_id: ownerChanged ? null : prev.owner_user_id,
      owner_contact_id: ownerChanged ? null : prev.owner_contact_id,
      client_id: prev.client_id,
      accord_id: prev.accord_id,
      project_id: prev.project_id,
      charter_id: prev.charter_id,
      site_id: prev.site_id,
      task_id: prev.task_id,
      arc_id: prev.arc_id,
      approval_request_id: prev.approval_request_id,
      email_thread_id: prev.email_thread_id,
      email_account: prev.email_account,
      blocks_client: step.blocks_client,
      client_waiting_since: prev.client_waiting_since,
      created_by_automation: 'sweeper',
      idempotency_key: `${prev.id}:next`,
    },
    { allowDisabled: true }
  );
}
