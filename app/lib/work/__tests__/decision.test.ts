// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { DISPOSITIONS, FLOOR_EXEMPTIONS, MACHINE_DECIDERS, RECEIPT_VETO_RE, applyFloors, floorExemptHolds, isVerifiedProviderReceipt, senderDomain, birthState, cleanReason, decideReplay, notHeldByMike, ownerFor, ownerOfAssignee, planSync, waitKeyFor, type ReplayAsk, type SyncExisting } from '../decision';

describe('applyFloors', () => {
  it.each([
    ['no_action', { is_urgent: true, intent: null }, 'reply_mike', 'no_action_refused_urgent'],
    ['waiting_them', { is_urgent: true, intent: null }, 'reply_mike', 'waiting_them_refused_urgent'],
    ['no_action', { is_urgent: false, intent: 'admin' }, 'reply_mike', 'no_action_refused_admin'],
    ['waiting_them', { is_urgent: false, intent: 'admin' }, 'reply_mike', 'waiting_them_refused_admin'],
    ['no_action', { is_urgent: false, intent: 'sales' }, 'reply_mike', 'no_action_refused_sales'],
    ['waiting_them', { is_urgent: false, intent: 'sales' }, 'reply_mike', 'waiting_them_refused_sales'],
    ['emergency', { is_urgent: false, intent: null }, 'reply_mike', 'emergency_without_urgent_flag'],
  ] as const)('%s with %j is %s', (d, facts, out, why) => {
    expect(applyFloors(d, facts)).toEqual({ disposition: out, adjusted: why });
  });

  it.each(DISPOSITIONS)('%s stands on an ordinary ask', (d) => {
    expect(applyFloors(d, { is_urgent: d === 'emergency', intent: null })).toEqual({ disposition: d, adjusted: null });
  });

  it('the floors only raise: reply_mike, work and meeting are never turned into no_action', () => {
    for (const d of ['reply_mike', 'work', 'meeting'] as const) {
      for (const facts of [{ is_urgent: true, intent: 'admin' }, { is_urgent: false, intent: 'sales' }, { is_urgent: false, intent: null }]) {
        expect(applyFloors(d, facts).disposition).toBe(d);
      }
    }
  });
});

describe('owner, birth state, wait key, reason', () => {
  it('owners by disposition', () => {
    expect(ownerFor('reply_mike')).toBe('mike');
    expect(ownerFor('meeting')).toBe('mike');
    expect(ownerFor('emergency')).toBe('mike');
    expect(ownerFor('no_action')).toBe('nobody');
    expect(ownerFor('waiting_them')).toBe('nobody');
    expect(ownerFor('work')).toBeNull();
    expect(ownerFor('work', 'bast')).toBe('bast');
  });
  it('assignee words', () => {
    expect(ownerOfAssignee('bot', 'me', ['bot'])).toBe('bast');
    expect(ownerOfAssignee('me', 'me', ['bot'])).toBe('mike');
    expect(ownerOfAssignee(null, 'me', ['bot'])).toBe('mike');
    expect(ownerOfAssignee('x', 'me', ['bot'])).toBe('sabeen');
  });
  it('only no_action and waiting_them are born handled; only waiting_them opens a wait', () => {
    expect(birthState('no_action')).toEqual({ state: 'handled', closed_reason: 'no_action', closed_by: 'intake', wait: false });
    expect(birthState('waiting_them')).toEqual({ state: 'handled', closed_reason: 'waiting_them', closed_by: 'intake', wait: true });
    for (const d of ['reply_mike', 'work', 'meeting', 'emergency'] as const) expect(birthState(d)).toEqual({ state: 'open', closed_reason: null, closed_by: null, wait: false });
  });
  it('wait key is the conversation, else the message', () => {
    expect(waitKeyFor('root@x', 'm1')).toBe('conv:root@x');
    expect(waitKeyFor(null, 'm1')).toBe('msg:m1');
    expect(waitKeyFor('  ', 'm1')).toBe('msg:m1');
  });
  it('a reason is one plain line of at most 120 characters with no dash', () => {
    expect(cleanReason('A thank-you — nothing asked')).toBe('A thank-you , nothing asked');
    expect(cleanReason('a\nb   c')).toBe('a b c');
    expect(cleanReason('x'.repeat(300))?.length).toBe(119);
    expect(cleanReason('   ')).toBeNull();
    expect(cleanReason(null)).toBeNull();
  });
  it('the hold fragment names asks he has not decided', () => {
    expect(notHeldByMike.OR).toHaveLength(2);
  });
});

describe('planSync', () => {
  const ex = (o: Partial<SyncExisting> = {}): SyncExisting => ({ disposition: null, decided_by: null, intent: null, task_id: null, state: 'open', closed_by: null, is_urgent: false, ...o });
  const post = (d: 'no_action' | 'reply_mike' | 'work' | 'meeting' | 'waiting_them' | 'emergency', o: Partial<Parameters<typeof planSync>[1]> = {}) => ({ disposition: d, reason: 'r', is_urgent: false, intent: null, ...o });

  it('a new no_action row is born handled, once', () => {
    const p = planSync(null, post('no_action'));
    expect(p.fields).toMatchObject({ state: 'handled', closed_reason: 'no_action', closed_by: 'intake', disposition: 'no_action', owner: 'nobody', decided_by: 'intake', disposition_reason: 'r' });
    expect(p.prior).toBeNull();
  });
  it('a new urgent no_action is reply_mike, open, adjusted', () => {
    const p = planSync(null, post('no_action', { is_urgent: true }));
    expect(p.disposition).toBe('reply_mike');
    expect('state' in p.fields).toBe(false);
    expect(p.adjusted).toBe('no_action_refused_urgent');
  });
  it('an existing undecided row never takes no_action or waiting_them', () => {
    for (const d of ['no_action', 'waiting_them'] as const) {
      const p = planSync(ex(), post(d));
      expect(p.fields).toEqual({});
      expect(p.adjusted).toBe('close_only_at_birth');
    }
  });
  it('an existing undecided row takes reply_mike, meeting, emergency; work only with a task', () => {
    expect(planSync(ex(), post('reply_mike')).fields).toMatchObject({ disposition: 'reply_mike' });
    expect(planSync(ex(), post('meeting')).fields).toMatchObject({ disposition: 'meeting' });
    expect(planSync(ex(), post('emergency', { is_urgent: true })).fields).toMatchObject({ disposition: 'emergency' });
    expect(planSync(ex(), post('work')).fields).toEqual({});
    expect(planSync(ex({ task_id: 't', task_owner: 'bast' }), post('work')).fields).toMatchObject({ disposition: 'work', owner: 'bast' });
  });
  it('a decided row is never rewritten, and reports prior', () => {
    const p = planSync(ex({ disposition: 'reply_mike', task_id: 't' }), post('meeting'));
    expect(p.fields).toEqual({});
    expect(p.prior).toEqual({ disposition: 'reply_mike', task_id: 't' });
  });
  it('his own decision holds', () => {
    const p = planSync(ex({ disposition: 'reply_mike', decided_by: 'mike' }), post('no_action'));
    expect(p.fields).toEqual({});
    expect(p.adjusted).toBe('held_by_mike');
    // even an undecided row he touched
    expect(planSync(ex({ decided_by: 'mike' }), post('reply_mike')).fields).toEqual({});
  });
  it('an intake close that turns urgent reopens as an emergency (the floors only raise)', () => {
    const p = planSync(ex({ disposition: 'no_action', decided_by: 'intake', state: 'handled', closed_by: 'intake' }), post('emergency', { is_urgent: true }));
    expect(p.reopen).toBe(true);
    expect(p.fields).toMatchObject({ state: 'open', disposition: 'emergency', closed_at: null, closed_reason: null, closed_by: null });
  });
  it('but never one he reopened and re-decided', () => {
    const p = planSync(ex({ disposition: 'reply_mike', decided_by: 'mike', state: 'handled', closed_by: 'intake' }), post('emergency', { is_urgent: true }));
    expect(p.reopen).toBe(false);
  });
});

describe('decideReplay', () => {
  const ask = (o: Partial<ReplayAsk> = {}): ReplayAsk => ({ id: 'a1', state: 'open', disposition: null, decided_by: null, is_urgent: false, intent: null, task_id: null, task_security: false, ...o });
  const run = (a: ReplayAsk | null, d: string) => decideReplay(a, { disposition: d });

  it('closes only an open, undecided no_action', () => {
    expect(run(ask(), 'no_action')).toMatchObject({ verdict: 'close', disposition: 'no_action' });
    expect(run(ask({ state: 'handled' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'not_open' });
    expect(run(ask({ disposition: 'reply_mike' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ decided_by: 'mike' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'held_by_mike' });
  });
  it('never closes urgent, admin, sales or a security task ask', () => {
    expect(run(ask({ is_urgent: true }), 'no_action')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask({ intent: 'admin' }), 'no_action')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask({ intent: 'sales' }), 'no_action')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask({ task_security: true, task_id: 't' }), 'no_action')).toMatchObject({ verdict: 'leave', why: 'security_task' });
  });
  it('stores the others without closing', () => {
    expect(run(ask(), 'reply_mike')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask(), 'meeting')).toMatchObject({ verdict: 'set', disposition: 'meeting' });
    expect(run(ask(), 'work')).toMatchObject({ verdict: 'leave', why: 'work_without_task' });
    expect(run(ask({ task_id: 't' }), 'work')).toMatchObject({ verdict: 'set', disposition: 'work' });
    expect(run(ask(), 'waiting_them')).toMatchObject({ verdict: 'leave', why: 'waiting_not_applied' });
    expect(run(ask({ is_urgent: true }), 'emergency')).toMatchObject({ verdict: 'set', disposition: 'emergency' });
    expect(run(ask(), 'emergency')).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
  });
  it('refuses a missing ask and a value outside the list', () => {
    expect(run(null, 'no_action').verdict).toBe('refused');
    expect(run(ask(), 'ignore').verdict).toBe('refused');
  });
});

describe('the provider receipt exemption', () => {
  const rec = (o: Partial<Parameters<typeof isVerifiedProviderReceipt>[0]> = {}) => ({
    subject: 'Payment received: Invoice #1042-(Acme Co)', from_email: 'quickbooks@notification.intuit.com', gist: 'A payment came in.', is_urgent: false, intent: 'admin', ...o,
  });

  it('the only exemption is provider_receipt', () => {
    expect([...FLOOR_EXEMPTIONS]).toEqual(['provider_receipt']);
  });

  it.each([
    ['Payment received: Invoice #1042-(Acme Co)', 'quickbooks@notification.intuit.com'],
    ['Payment received: Invoice 77', 'x@intuit.com'],
    ['Invoice 55 from Indelible, Inc.', 'quickbooks@notification.intuit.com'],
    ['Congrats, you just got paid!', 'no-reply@waveapps.com'],
    ['Invoice #7 from Who Is Mike Dion? LLC', 'invoices@waveapps.com'],
    ['Your invoice is available', 'no-reply@notify.cloudflare.com'],
    ['Your invoice is available', 'billing@cloudflare.com'],
    ['Google Workspace: Your invoice is available for example.com', 'payments-noreply@google.com'],
    ['Your invoice is available', 'payments-noreply@google.com'],
    ['Amazon Web Services Billing Statement Available [Account: 123456789012]', 'no-reply-aws@aws.com'],
    ['Amazon Web Services Billing Statement Available', 'no-reply-aws@amazon.com'],
    ['AWS Billing Statement Available [Account: 1]', 'no-reply-aws@aws.com'],
    ['Your AWS invoice is available', 'billing@aws.com'],
    ['Your invoice is available', 'billing@aws.com'],
  ])('%s from %s verifies', (subject, from_email) => {
    expect(isVerifiedProviderReceipt(rec({ subject, from_email }))).toBe(true);
  });

  it('a receipt subject from a lookalike or wrong provider domain does not verify', () => {
    for (const from_email of ['x@notintuit.com', 'x@intuit.com.evil.test', 'x@intuit-billing.com', 'x@waveapps.com.evil.test', 'x@mail.google.com.evil.test', 'x@evilcloudflare.com', 'x@aws.com.evil.test', 'x@sub.aws.com', 'x@sub.google.com', 'x@gmail.com']) {
      expect(isVerifiedProviderReceipt(rec({ from_email }))).toBe(false);
      expect(isVerifiedProviderReceipt(rec({ from_email, subject: 'Your invoice is available' }))).toBe(false);
    }
  });

  it('a provider subject from another provider does not verify', () => {
    expect(isVerifiedProviderReceipt(rec({ subject: 'Congrats, you just got paid!', from_email: 'x@intuit.com' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: 'Payment received: Invoice #9', from_email: 'x@waveapps.com' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: 'Payment received: Invoice #9', from_email: 'x@cloudflare.com' }))).toBe(false);
  });

  it('a sender that is not exactly one plain address does not verify', () => {
    for (const from_email of ['', null, undefined, 'intuit.com', 'a@intuit.com, b@evil.test', 'Intuit <a@intuit.com>', 'a@b@intuit.com']) {
      expect(isVerifiedProviderReceipt(rec({ from_email }))).toBe(false);
    }
  });

  it('subjects off the closed list do not verify', () => {
    for (const subject of ['Invoice 55 from Someone Else', 'Your invoice is available now, pay today', 'Your invoice', 'Invoice #4 from Indelible', 'FYI Payment received: Invoice #1', '', null, undefined]) {
      if (subject === 'Invoice #4 from Indelible') {
        expect(isVerifiedProviderReceipt(rec({ subject }))).toBe(true);
      } else {
        expect(isVerifiedProviderReceipt(rec({ subject }))).toBe(false);
      }
    }
  });

  it.each([
    'failed', 'declined', 'past due', 'unpaid', 'suspended', 'action required', 'expires soon', 'warning', 'suspicious login', 'security notice', 'unauthorized charge', 'overdue', 'final notice',
  ])('trouble wording "%s" in the gist vetoes it', (w) => {
    expect(isVerifiedProviderReceipt(rec({ gist: `Heads up: ${w}` }))).toBe(false);
    expect(RECEIPT_VETO_RE.test(w)).toBe(true);
  });

  it('trouble wording in the subject vetoes it, even on a listed provider', () => {
    expect(isVerifiedProviderReceipt(rec({ subject: 'Your invoice is available', from_email: 'x@notify.cloudflare.com' }))).toBe(true);
    expect(isVerifiedProviderReceipt(rec({ subject: 'Payment received: Invoice #12-(Security Past Due LLC)' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: 'Payment received: Invoice #12 failed' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: 'Action required: Your AWS account is past due', from_email: 'x@aws.com' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: '[Action required] Payment failed for invoice #IN-1', from_email: 'x@notify.cloudflare.com' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: 'Action required: your billing account has been suspended.', from_email: 'x@google.com' }))).toBe(false);
  });

  it('an urgent ask, a sales ask or a non-admin intent never verifies', () => {
    expect(isVerifiedProviderReceipt(rec({ is_urgent: true }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ intent: 'sales' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ intent: 'general' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ intent: null }))).toBe(false);
  });

  it('senderDomain reads one plain address only', () => {
    expect(senderDomain(' A@Notification.Intuit.com ')).toBe('notification.intuit.com');
    expect(senderDomain('nope')).toBeNull();
  });

  const facts = (o: Record<string, unknown> = {}) => ({
    is_urgent: false, intent: 'admin',
    exempt: { kind: 'provider_receipt' as const, subject: 'Payment received: Invoice #1042-(Acme Co)', from_email: 'q@notification.intuit.com', gist: 'g' }, ...o,
  });

  it('applyFloors lets a verified receipt through the admin floor, as no_action only', () => {
    expect(applyFloors('no_action', facts())).toEqual({ disposition: 'no_action', adjusted: null, exempted: 'provider_receipt' });
    expect(applyFloors('waiting_them', facts())).toEqual({ disposition: 'reply_mike', adjusted: 'waiting_them_refused_admin' });
  });

  it('applyFloors keeps the floor for a claim the server cannot verify, a missing claim, urgent and sales', () => {
    const bad = { kind: 'provider_receipt' as const, subject: 'Payment received: Invoice #1', from_email: 'q@intuit.com.evil.test', gist: 'g' };
    expect(applyFloors('no_action', facts({ exempt: bad }))).toEqual({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
    expect(applyFloors('no_action', facts({ exempt: undefined }))).toEqual({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
    expect(applyFloors('no_action', facts({ exempt: { ...facts().exempt, kind: null } }))).toEqual({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
    expect(applyFloors('no_action', facts({ is_urgent: true }))).toEqual({ disposition: 'reply_mike', adjusted: 'no_action_refused_urgent' });
    expect(applyFloors('no_action', facts({ intent: 'sales' }))).toEqual({ disposition: 'reply_mike', adjusted: 'no_action_refused_sales' });
    expect(floorExemptHolds(facts({ intent: 'general' }))).toBe(false);
  });

  it('planSync records a verified receipt as handled at birth and ignores an unverified claim', () => {
    const posted = { disposition: 'no_action' as const, reason: 'A routine receipt that asks nothing.', is_urgent: false, intent: 'admin', floor_exempt: 'provider_receipt' as const, subject: 'Payment received: Invoice #5', from_email: 'q@notification.intuit.com', gist: 'g' };
    const ok = planSync(null, posted);
    expect(ok).toMatchObject({ disposition: 'no_action', exempted: 'provider_receipt', adjusted: null });
    expect(ok.birth?.state).toBe('handled');
    const bad = planSync(null, { ...posted, from_email: 'q@notintuit.com' });
    expect(bad).toMatchObject({ disposition: 'reply_mike', adjusted: 'no_action_refused_admin' });
    expect(bad.exempted).toBeUndefined();
    expect(planSync(null, { ...posted, gist: 'Payment failed' })).toMatchObject({ disposition: 'reply_mike' });
    expect(planSync(null, { ...posted, floor_exempt: null })).toMatchObject({ disposition: 'reply_mike' });
  });

  it('planSync never closes an existing row, exempt or not', () => {
    const ex: SyncExisting = { disposition: null, decided_by: null, intent: 'admin', task_id: null, state: 'open', closed_by: null, is_urgent: false };
    const p = planSync(ex, { disposition: 'no_action', reason: null, is_urgent: false, intent: 'admin', floor_exempt: 'provider_receipt', subject: 'Payment received: Invoice #5', from_email: 'q@intuit.com', gist: null });
    expect(p).toMatchObject({ disposition: null, adjusted: 'close_only_at_birth' });
  });
});

describe('decideReplay and the provider receipt exemption', () => {
  const ask = (o: Partial<ReplayAsk> = {}): ReplayAsk => ({
    id: 'a1', state: 'open', disposition: null, decided_by: null, is_urgent: false, intent: 'admin', task_id: null, task_security: false,
    subject: 'Payment received: Invoice #1042-(Acme Co)', from_email: 'q@notification.intuit.com', gist: 'g', ...o,
  });
  const run = (a: ReplayAsk | null, d = 'no_action', floor_exempt: 'provider_receipt' | null = 'provider_receipt') => decideReplay(a, { disposition: d, floor_exempt });

  it('an undecided verified receipt closes through the exempt path', () => {
    expect(run(ask())).toMatchObject({ verdict: 'close', disposition: 'no_action', why: 'provider_receipt' });
  });
  it('the same ask without the claim, or failing the check, is floored to reply_mike as today', () => {
    expect(run(ask(), 'no_action', null)).toMatchObject({ verdict: 'set', disposition: 'reply_mike', why: 'no_action_refused_admin' });
    expect(run(ask({ from_email: 'q@intuit.com.evil.test' }))).toMatchObject({ verdict: 'set', disposition: 'reply_mike', why: 'no_action_refused_admin' });
    expect(run(ask({ gist: 'Payment failed' }))).toMatchObject({ verdict: 'set', disposition: 'reply_mike' });
    expect(run(ask({ intent: 'sales' }))).toMatchObject({ verdict: 'set', disposition: 'reply_mike', why: 'no_action_refused_sales' });
    expect(run(ask({ is_urgent: true }))).toMatchObject({ verdict: 'set', disposition: 'reply_mike', why: 'no_action_refused_urgent' });
  });
  it('an undecided verified receipt held by his reopen or on a security task is left', () => {
    expect(run(ask({ decided_by: 'mike' }))).toMatchObject({ verdict: 'leave', why: 'held_by_mike' });
    expect(run(ask({ task_security: true, task_id: 't' }))).toMatchObject({ verdict: 'leave', why: 'security_task' });
  });
  it.each([...MACHINE_DECIDERS])('a stored reply_mike decided by %s changes to no_action only for a verified receipt', (by) => {
    expect(run(ask({ disposition: 'reply_mike', decided_by: by }))).toMatchObject({ verdict: 'close', disposition: 'no_action', why: 'provider_receipt_redecided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: by }), 'no_action', null)).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: by, from_email: 'q@notintuit.com' }))).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: by, gist: 'past due' }))).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: by, is_urgent: true }))).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: by, intent: 'sales' }))).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: by, task_security: true, task_id: 't' }))).toMatchObject({ verdict: 'leave', why: 'security_task' });
  });
  it('a stored reply_mike decided by him, or with no decider, is never changed', () => {
    expect(run(ask({ disposition: 'reply_mike', decided_by: 'mike' }))).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: null }))).toMatchObject({ verdict: 'leave', why: 'already_decided' });
  });
  it('only reply_mike is redecided, and only to no_action', () => {
    for (const disposition of ['emergency', 'meeting', 'work', 'no_action', 'waiting_them']) {
      expect(run(ask({ disposition, decided_by: 'intake' }))).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    }
    expect(run(ask({ disposition: 'reply_mike', decided_by: 'intake' }), 'meeting')).toMatchObject({ verdict: 'leave', why: 'already_decided' });
    expect(run(ask({ disposition: 'reply_mike', decided_by: 'intake', state: 'handled' }))).toMatchObject({ verdict: 'leave', why: 'not_open' });
  });
  it('a receipt that lacks facts (an old caller) cannot pass', () => {
    const a = ask({ disposition: 'reply_mike', decided_by: 'intake' });
    delete a.from_email;
    expect(run(a)).toMatchObject({ verdict: 'leave', why: 'already_decided' });
  });
});

describe('the routine invoice senders added with the home checklist work', () => {
  const rec = (o: Partial<Parameters<typeof isVerifiedProviderReceipt>[0]>) => ({ subject: '', from_email: '', gist: 'A routine notice.', is_urgent: false, intent: 'admin', ...o });
  const CASES: [string, string, string][] = [
    ['Cloudways', '[Cloudways] Your 2026-10 invoice for team: Indelible is available', 'billing@cloudways.com'],
    ['AmeriGas', 'Acct No. 203740388: Your Invoice from AmeriGas Propane is Available Online', 'noreply@billtrust.com'],
    ['SendGrid', 'You have a new invoice from SendGrid (INV20070252)', 'billing@sendgrid.com'],
    ['Vermontel', 'Your bill is available to view online', 'vermontel-no-reply@smarthub.coop'],
    ['Nexudus new', 'New Invoice from Black River Innovation Campus', 'noreply@mail.nexudus.com'],
    ['Nexudus paid', 'Payment Confirmation for invoice #BRIC-INV-0063', 'noreply@mail.nexudus.com'],
    ['AWS relay', 'Amazon Web Services Billing Statement Available [Account: 245112717090]', 'support@becomeindelible.com'],
    ['AWS relay bare', 'Amazon Web Services Billing Statement Available', 'support@becomeindelible.com'],
  ];
  it.each(CASES)('%s fires on its sample subject', (_n, subject, from_email) => {
    expect(isVerifiedProviderReceipt(rec({ subject, from_email }))).toBe(true);
    expect(applyFloors('no_action', { is_urgent: false, intent: 'admin', exempt: { kind: 'provider_receipt', subject, from_email, gist: 'x' } }).disposition).toBe('no_action');
  });
  it.each(CASES)('%s does not fire with trouble wording in the subject or the gist', (_n, subject, from_email) => {
    expect(isVerifiedProviderReceipt(rec({ subject: `${subject} past due`, from_email }))).toBe(false);
    for (const gist of ['Payment failed, action required', 'Your account is suspended', 'Past due balance']) {
      expect(isVerifiedProviderReceipt(rec({ subject, from_email, gist }))).toBe(false);
    }
  });
  it.each(CASES)('%s does not fire from a lookalike domain or when urgent or not admin', (_n, subject, from_email) => {
    const [local, dom] = from_email.split('@');
    for (const bad of [`${local}@${dom}.evil.test`, `${local}@evil${dom}`, `${local}@gmail.com`]) {
      expect(isVerifiedProviderReceipt(rec({ subject, from_email: bad }))).toBe(false);
    }
    expect(isVerifiedProviderReceipt(rec({ subject, from_email, is_urgent: true }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject, from_email, intent: 'work' }))).toBe(false);
  });
  it('AmeriGas tolerates a tail on the subject, Cloudways any team name and month', () => {
    expect(isVerifiedProviderReceipt(rec({ subject: 'Acct No. 1: Your Invoice from AmeriGas Propane is Available Online - Reminder', from_email: 'a@billtrust.com' }))).toBe(true);
    expect(isVerifiedProviderReceipt(rec({ subject: '[Cloudways] Your 2027-01 invoice for team: Some Other Team is available', from_email: 'a@cloudways.com' }))).toBe(true);
  });
  it('the AWS relay needs exactly support@becomeindelible.com and that subject shape', () => {
    const subject = 'Amazon Web Services Billing Statement Available [Account: 245112717090]';
    for (const from_email of ['bast@becomeindelible.com', 'Support@becomeindelible.com.evil.test', 'billing@becomeindelible.com', 'support2@becomeindelible.com']) {
      expect(isVerifiedProviderReceipt(rec({ subject, from_email }))).toBe(false);
    }
    for (const other of ['Your invoice is available', 'Invoice question', 'Your AWS invoice is available']) {
      expect(isVerifiedProviderReceipt(rec({ subject: other, from_email: 'support@becomeindelible.com' }))).toBe(false);
    }
    expect(isVerifiedProviderReceipt(rec({ subject, from_email: 'SUPPORT@becomeindelible.com' }))).toBe(true);
  });
  it('a subject off the shape does not fire', () => {
    expect(isVerifiedProviderReceipt(rec({ subject: 'Your bill is available to view online, call us', from_email: 'a@smarthub.coop' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: 'New Invoice from Someone Else', from_email: 'a@mail.nexudus.com' }))).toBe(false);
    expect(isVerifiedProviderReceipt(rec({ subject: 'You have a new invoice from SendGrid', from_email: 'a@sendgrid.com' }))).toBe(false);
  });
});
