import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { gateReply, type GateContext } from '@/lib/portal/chat/gate';
import { buildProvenance, extractResultNumbers, isoDate } from '@/lib/portal/chat/provenance';
import { reportedDates } from '@/lib/engine/tool-calls';
import { askAllowed, awayEmailEligible, isQuestionConversation } from '@/lib/portal/chat/slots';
import { answerLine, buildAwayBody, buildReplyBody, quoteClient } from '@/lib/portal/chat/mailer';

// Pilot finding 2026-10-21 (Abbott, task 9271fe97): a September data gap became "Want me to pass the
// September question to the team?", an open ask on a question chat, and the sweep mailed it as a
// blocking question on a request ("the number is fine", no choices, no quote of what it referred to).

const SEP_EMPTY = {
  label: 'Google Analytics, Sep 1 to Sep 30, 2026 (data through Sep 30)',
  totals: {},
  rows: [],
  row_count: 0,
  data_starts: '2026-10-18',
  no_data_note: 'Google Analytics for this site starts on Oct 18, 2026, so there is no September data.',
};
const OCT = { label: 'Google Analytics, Oct 1 to Oct 20, 2026 (data through Oct 20)', totals: { totalUsers: 26, sessions: 26 }, rows: [], row_count: 1 };

function ctxFor(results: Array<{ tool: string; result: Record<string, unknown> }>): GateContext {
  const calls = results.map((r) => ({ tool: r.tool, label: r.result.label as string, result_numbers: extractResultNumbers(r.result), dates: reportedDates(r.tool, r.result) }));
  return {
    provenance: buildProvenance(calls),
    staffNames: ['Mike'],
    otherClientNames: [],
    clientDomains: ['maplestreetbakery.com'],
    portalOrigins: ['https://citadel.becomeindelible.com'],
    reportUrls: [],
    contactEmail: null,
  };
}

describe('a data gap is an answer (gate and provenance)', () => {
  const ANSWER =
    'Google Analytics, Oct 1 to Oct 20, 2026, counted 26 people and 26 visits. Google Analytics for this site starts on Oct 18, 2026, so there is no September data. Anything else?';

  it('the start date the tool reported passes in a sentence that names the source', () => {
    const ctx = ctxFor([{ tool: 'ga4_report', result: OCT }, { tool: 'ga4_report', result: SEP_EMPTY }]);
    expect(gateReply(ANSWER, ctx, 'reply')).toEqual({ ok: true });
    expect(gateReply(SEP_EMPTY.no_data_note, ctx, 'reply')).toEqual({ ok: true });
  });

  it('the same date without the tool having reported it is refused', () => {
    const ctx = ctxFor([{ tool: 'ga4_report', result: OCT }, { tool: 'ga4_report', result: { ...SEP_EMPTY, data_starts: undefined } }]);
    expect(gateReply(ANSWER, ctx, 'reply').ok).toBe(false);
  });

  it('a reported date still needs the source named in its sentence, and the exact day', () => {
    const ctx = ctxFor([{ tool: 'ga4_report', result: SEP_EMPTY }]);
    expect(gateReply('The numbers start on Oct 18, 2026.', ctx, 'reply').ok).toBe(false);
    expect(gateReply('Google Analytics for this site starts on Oct 17, 2026.', ctx, 'reply').ok).toBe(false);
  });

  it("system.md's worked Turn 12 passes the gate with the provenance it describes, and carries no ask", () => {
    const file = '/home/mike/.claude/tools/portal-chat/prompts/system.md';
    if (!fs.existsSync(file)) return; // the prompt lives on the Bast machine; CI has no copy
    const md = fs.readFileSync(file, 'utf8');
    const turn = md.slice(md.indexOf('### Turn 12.'));
    const json = JSON.parse(turn.slice(turn.indexOf('```json') + 7, turn.indexOf('```', turn.indexOf('```json') + 7)));
    const ctx = ctxFor([
      { tool: 'ga4_report', result: { label: 'Google Analytics, Oct 1 to Oct 20, 2026 (data through Oct 20)', totals: { totalUsers: 412, sessions: 530 }, rows: [], row_count: 1 } },
      { tool: 'ga4_report', result: { label: SEP_EMPTY.label, rows: [], row_count: 0, data_starts: '2026-10-06', no_data_note: 'Google Analytics for this site starts on Oct 6, 2026, so there is no September data.' } },
    ]);
    expect(gateReply(json.reply, ctx, 'reply')).toEqual({ ok: true });
    expect(json.actions.map((a: { type: string }) => a.type)).toEqual(['close_question']);
    expect(turn).toContain('so there is no September data.');
  });

  it('only ga4_report reports a start date, and only a whole ISO date counts', () => {
    expect(reportedDates('ga4_report', SEP_EMPTY)).toEqual(['2026-10-18']);
    expect(reportedDates('search_console', SEP_EMPTY)).toEqual([]);
    expect(reportedDates('ga4_report', { data_starts: '20261018' })).toEqual([]);
    expect(isoDate('2026-10-18')).toEqual({ m: 9, d: 18, y: 2026 });
    expect(isoDate('2026-13-01')).toBeNull();
    expect(extractResultNumbers(SEP_EMPTY)).toEqual(['0']); // row_count only: the date and the note carry no numbers
  });
});

describe('an ask belongs to a request only', () => {
  it('a question conversation never carries an ask', () => {
    expect(isQuestionConversation({ request_type: 'marketing_question' })).toBe(true);
    expect(askAllowed({ request_type: 'marketing_question' })).toBe(false);
    expect(askAllowed({ request_type: 'site_change' })).toBe(true);
    expect(askAllowed({})).toBe(true);
  });
  it('a result that closes a question carries no ask either', () => {
    expect(askAllowed({ request_type: 'site_change' }, { closesQuestion: true })).toBe(false);
  });
  it('the summary type counts when the slots have none', () => {
    expect(isQuestionConversation({ summary: { request_type: 'marketing_question', site_id: null, change: 'x', attachment_ids: [], text: 'x' } })).toBe(true);
  });
});

describe('away email eligibility', () => {
  const ask = (slot: string) => ({ slot, question: 'Which page should this photo go on?', choice_ids: [], allow_free_text: true, allow_upload: false });

  it('a request with a blocking ask: send', () => {
    for (const slot of ['site', 'page', 'section', 'change', 'asset']) {
      expect(awayEmailEligible({ state: 'clarifying', slots: { request_type: 'site_change' }, open_ask: ask(slot) }), slot).toBe(true);
    }
    expect(awayEmailEligible({ state: 'clarifying', slots: {}, open_ask: ask('page') })).toBe(true);
  });

  it('a request with a summary waiting for a yes: send', () => {
    expect(awayEmailEligible({ state: 'confirming', slots: { request_type: 'site_change' }, open_ask: null, summary_text: 'Replace the photo.' })).toBe(true);
  });

  it('a question conversation: never, whatever it holds', () => {
    const slots = { request_type: 'marketing_question' };
    for (const slot of ['site', 'page', 'section', 'change', 'asset', 'other']) {
      expect(awayEmailEligible({ state: 'clarifying', slots, open_ask: ask(slot) }), slot).toBe(false);
    }
    expect(awayEmailEligible({ state: 'confirming', slots, open_ask: null, summary_text: 'A question.' })).toBe(false);
  });

  it('an `other` ask: never, even on a request', () => {
    expect(awayEmailEligible({ state: 'clarifying', slots: { request_type: 'site_change' }, open_ask: ask('other') })).toBe(false);
  });

  it('no ask, or a conversation that is not open: never', () => {
    expect(awayEmailEligible({ state: 'clarifying', slots: { request_type: 'site_change' }, open_ask: null })).toBe(false);
    expect(awayEmailEligible({ state: 'with_person', slots: { request_type: 'site_change' }, open_ask: ask('page') })).toBe(false);
    expect(awayEmailEligible({ state: 'confirming', slots: { request_type: 'site_change' }, open_ask: null, summary_text: null })).toBe(false);
  });
});

describe('the away email body', () => {
  const f = { firstName: 'Dana', clientTitle: 'Change: new photo on the website', domain: 'maplestreetbakery.com', workUrl: 'https://citadel.example/portal/work/1', token: 'abcdefghijkl' };

  it('with choices: the request by name, the client quoted, the exact question, numbered choices, "Reply with the number"', () => {
    const body = buildAwayBody({ ...f, question: 'Which page should this photo go on?', choices: [{ label: 'About' }, { label: 'Home' }], clientLast: 'Can you add this picture to the website?' });
    expect(body).toBe(
      [
        'Hi Dana,',
        '',
        'Your request "Change: new photo on the website" (maplestreetbakery.com) needs one answer before the team can pick it up.',
        '',
        'You wrote:',
        '"Can you add this picture to the website?"',
        '',
        'Our question:',
        'Which page should this photo go on?',
        '',
        '1. About',
        '2. Home',
        '',
        'Reply with the number, or answer in the portal:',
        'https://citadel.example/portal/work/1',
        '',
        'Indelible Support',
        'Ref: IC-ABCDEF',
      ].join('\n')
    );
  });

  it('without choices: no number anywhere in the answer line', () => {
    const body = buildAwayBody({ ...f, question: 'What should the new banner say?', choices: [], clientLast: 'Change the banner please' });
    expect(body).toContain('Our question:\nWhat should the new banner say?\n\nReply to this email with your answer, or answer in the portal:');
    expect(body).not.toMatch(/number/i);
    expect(body).toContain('You wrote:\n"Change the banner please"');
  });

  it('a summary waiting for a yes, quoted and standalone', () => {
    const body = buildAwayBody({ ...f, question: '', choices: [], summary: 'On the About page, replace the team photo.', clientLast: 'Swap my headshot' });
    expect(body).toContain('Your request "Change: new photo on the website" (maplestreetbakery.com) is written up and needs your check before it goes to the team.');
    expect(body).toContain('Here is the request as we have it:\nOn the About page, replace the team photo.');
    expect(body).toContain("Reply 'send'");
    expect(body).not.toMatch(/number/i);
  });

  it('a long client message is cut, and no dashes appear', () => {
    const q = quoteClient('word '.repeat(200));
    expect(q!.length).toBeLessThanOrEqual(405);
    expect(q!.endsWith('..."')).toBe(true);
    expect(quoteClient('  ')).toBeNull();
    const body = buildAwayBody({ ...f, question: 'Which page?', choices: [], clientLast: null });
    expect(body).not.toContain('You wrote:');
    expect(body).not.toMatch(/[–—]| - /);
  });

  it('the email reply frame says "the number" only with choices too', () => {
    expect(answerLine(true)).toContain('number');
    expect(answerLine(false)).not.toContain('number');
    const plain = buildReplyBody({ ...f, reply: 'Which section is it in?', sources: [], question: 'Which section is it in?' });
    expect(plain).not.toMatch(/number/i);
    const picked = buildReplyBody({ ...f, reply: 'Which page?', sources: [], question: 'Which page?', choices: [{ label: 'Home' }] });
    expect(picked).toContain('Reply with the number, or answer in the portal:');
  });
});
