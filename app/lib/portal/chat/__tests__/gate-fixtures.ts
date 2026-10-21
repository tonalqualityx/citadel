/**
 * Gate fixtures (phase C spec 9.2): sentences the copy gate must refuse, each with the rule that
 * should refuse it, and sentences it must let through. Both run against the same provenance: one
 * Google Analytics read, one Search Console read and one invoices read, as the engine would log them.
 */
import { buildProvenance, extractResultNumbers, type ProvenanceCall } from '@/lib/portal/chat/provenance';
import type { GateContext, GateKind, GateRule } from '@/lib/portal/chat/gate';

export const GA4_RESULT = {
  label: 'Google Analytics, Oct 1 to Oct 20, 2026 (data through Oct 20)',
  totals: { sessions: 1234, totalUsers: 987, engagementRate: 0.456 },
  rows: [{ pagePath: '/', sessions: '600' }],
};
export const GSC_RESULT = {
  label: 'Google Search Console, Oct 1 to Oct 18, 2026 (Search Console data runs about 2 days behind)',
  totals: { clicks: 321, impressions: 9876, ctr: 0.0325, position: 12.4 },
};
export const INVOICES_RESULT = {
  invoices: [{ doc_number: '1042', txn_date: '2026-09-30', due_date: '2026-10-30', total: 1500, balance: 750.5, status: 'open' }],
};

export const CALLS: ProvenanceCall[] = [
  { tool: 'ga4_report', result_numbers: extractResultNumbers(GA4_RESULT), label: GA4_RESULT.label },
  { tool: 'search_console', result_numbers: extractResultNumbers(GSC_RESULT), label: GSC_RESULT.label },
  { tool: 'citadel_read', kind: 'invoices', result_numbers: extractResultNumbers(INVOICES_RESULT) },
];

export function fixtureContext(overrides: Partial<GateContext> = {}): GateContext {
  return {
    provenance: buildProvenance(CALLS, []),
    staffNames: ['Mike', 'Ashlei', 'Sabeen'],
    otherClientNames: ['Bootleggers Beverage', 'Abbott Septic'],
    clientDomains: ['herbapumps.com'],
    portalOrigins: ['https://citadel.becomeindelible.com'],
    reportUrls: ['https://reports.becomeindelible.com/r/abc'],
    contactEmail: 'dana@herbapumps.com',
    ...overrides,
  };
}

export interface FailFixture {
  text: string;
  rule: GateRule;
  kind?: GateKind;
}

const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ');

export const MUST_FAIL: FailFixture[] = [
  // person
  { text: 'I am a real person on the team.', rule: 'person' },
  { text: "I'm a human, not a bot.", rule: 'person' },
  { text: 'I am not an AI.', rule: 'person' },
  { text: 'My name is Sam and I will pass this on.', rule: 'person' },
  // dash law
  { text: 'Got it — which page?', rule: 'dash' },
  { text: 'Got it – which page?', rule: 'dash' },
  { text: 'Got it &mdash; which page?', rule: 'dash' },
  { text: 'Got it &#8211; which page?', rule: 'dash' },
  { text: 'Got it &#x2014; which page?', rule: 'dash' },
  { text: 'Got it - which page?', rule: 'dash' },
  { text: 'Thanks -- which page?', rule: 'dash' },
  // names
  { text: 'Mike will call you.', rule: 'name' },
  { text: 'Ashlei can help with that.', rule: 'name' },
  { text: 'Bast will look at it.', rule: 'name' },
  { text: 'B​ast will look at it.', rule: 'name' },
  { text: 'Ｂａｓｔ will look at it.', rule: 'name' },
  { text: 'Bootleggers Beverage had the same request.', rule: 'name' },
  { text: 'Abbott Septic asked for that too.', rule: 'name' },
  { text: 'Sabeen reviewed it.', rule: 'name' },
  // internal words
  { text: 'I tagged it needs-mike.', rule: 'internal' },
  { text: 'It is tagged chat-clarifying.', rule: 'internal' },
  { text: 'I opened a ticket for this.', rule: 'internal' },
  { text: 'Citadel shows it as open.', rule: 'internal' },
  { text: 'The model could not find it.', rule: 'internal' },
  { text: 'My prompt says to ask you.', rule: 'internal' },
  { text: 'I called ga4_report for that.', rule: 'internal' },
  { text: 'Your kind:request is saved.', rule: 'internal' },
  // links and addresses
  { text: 'See https://evil.example/login.', rule: 'link' },
  { text: 'Visit evil.example for details.', rule: 'link' },
  { text: 'Email help@evil.example.', rule: 'link' },
  { text: 'Write to help@becomeindelible.com.', rule: 'link' },
  { text: 'See http://herbapumps.com.evil.example/x.', rule: 'link' },
  { text: 'Open https://citadel.becomeindelible.com.evil.example/.', rule: 'link' },
  { text: 'Your report is at https://reports.becomeindelible.com/other.', rule: 'link' },
  { text: 'Check www.example.org today.', rule: 'link' },
  // estimates
  { text: 'About 400 people visited, per Google Analytics, Oct 1 to Oct 20, 2026.', rule: 'estimate' },
  { text: 'Roughly 1,234 sessions in Google Analytics, Oct 1 to Oct 20, 2026.', rule: 'estimate' },
  { text: 'Around 987 people came, per Google Analytics, Oct 1 to Oct 20, 2026.', rule: 'estimate' },
  { text: 'Approximately 321 clicks in Search Console, Oct 1 to Oct 18, 2026.', rule: 'estimate' },
  { text: 'That is nearly 10 visits a day.', rule: 'estimate' },
  { text: 'You should reach 2,000 sessions.', rule: 'estimate' },
  { text: 'You are on track to hit 5,000.', rule: 'estimate' },
  { text: 'The estimated traffic is 900.', rule: 'estimate' },
  // promises
  { text: 'It will be done tomorrow.', rule: 'promise' },
  { text: 'That will cost less than you expect.', rule: 'promise' },
  { text: 'The price is low.', rule: 'promise' },
  { text: 'We can do it for $200.', rule: 'promise' },
  { text: 'It is free for you.', rule: 'promise' },
  { text: 'We guarantee good work.', rule: 'promise' },
  { text: 'That is included in your plan.', rule: 'promise' },
  { text: 'You will hear back by Friday.', rule: 'promise' },
  { text: 'Expect it within 5 days.', rule: 'promise' },
  { text: 'It will take 2 days.', rule: 'promise' },
  { text: 'We replied on October 3.', rule: 'promise' },
  { text: 'Revenue was $9,999.', rule: 'promise' },
  { text: 'Your balance is $751.', rule: 'promise' },
  // approval
  { text: 'Your request is approved.', rule: 'approval' },
  { text: 'That is covered by your plan.', rule: 'approval' },
  { text: 'That is in scope.', rule: 'approval' },
  { text: 'That is out of scope.', rule: 'approval' },
  { text: 'Go ahead and send the file.', rule: 'approval' },
  { text: 'This is part of your plan.', rule: 'approval' },
  { text: 'It is signed off.', rule: 'approval' },
  // commitments
  { text: 'We will build the page.', rule: 'commitment' },
  { text: "I'll update the banner.", rule: 'commitment' },
  { text: 'The team will fix it.', rule: 'commitment' },
  { text: 'We can redesign that.', rule: 'commitment' },
  { text: 'I will send an invoice.', rule: 'commitment' },
  { text: 'We are going to launch it.', rule: 'commitment' },
  // numbers nothing backs
  { text: 'You had 77 visitors.', rule: 'unsourced_number' },
  { text: 'There were 5,432 sessions.', rule: 'unsourced_number' },
  { text: 'Traffic grew 17% last month.', rule: 'unsourced_number' },
  { text: 'Rank 4 for that search.', rule: 'unsourced_number' },
  { text: 'You have 3rd place.', rule: 'unsourced_number' },
  { text: 'GA4 shows traffic.', rule: 'unsourced_number' },
  { text: 'Visit 6 pages.', rule: 'unsourced_number' },
  { text: 'Your rate is 8.5%.', rule: 'unsourced_number' },
  { text: 'Call 802 555 0100.', rule: 'unsourced_number' },
  // a real number with no source or no dates
  { text: 'You had 1,234 sessions.', rule: 'source' },
  { text: '1,234 sessions in Google Analytics.', rule: 'source' },
  { text: 'Oct 1 to Oct 20, 2026 had 1,234 sessions.', rule: 'source' },
  { text: 'Search Console had 321 clicks.', rule: 'source' },
  { text: '987 people visited, per Google Analytics.', rule: 'source' },
  { text: 'Google Analytics, Oct 1 to Oct 20, 2026. Thanks. You had 1,234 sessions.', rule: 'source' },
  // length
  { text: words(71), rule: 'length' },
  { text: 'Yes. No. Maybe. Sure. Okay.', rule: 'length' },
  { text: words(71), rule: 'length', kind: 'ask' },
  { text: words(81), rule: 'length', kind: 'summary' },
  { text: 'One. Two. Three. Four. Five.', rule: 'length' },
];

export const MUST_PASS: Array<{ text: string; kind?: GateKind }> = [
  { text: 'Which page is the photo for?' },
  { text: 'Thanks. Is it the team section or the top banner?' },
  { text: 'The team will review this.' },
  { text: 'I can see that. Could you tell me which page you mean?' },
  { text: 'Got it. The change is to the opening line on the About page.' },
  { text: 'Google Analytics, Oct 1 to Oct 20, 2026: 1,234 sessions.' },
  { text: 'From Google Analytics, 987 people visited the site between Oct 1 and Oct 20, 2026.' },
  { text: 'Search Console shows 321 clicks from Oct 1 to Oct 18, 2026.' },
  { text: 'Google Search Console, Oct 1 to Oct 18, 2026: 9,876 impressions and 321 clicks.' },
  { text: 'Your engagement rate was 45.6% in Google Analytics, Oct 1 to Oct 20, 2026.' },
  { text: 'Average position was 12.4 in Google Search Console, Oct 1 to Oct 18, 2026.' },
  { text: 'The click rate was 3.25% according to Google Search Console, Oct 1 to Oct 18, 2026.' },
  { text: 'Your open invoice balance is $750.50.' },
  { text: 'Invoice 1042 has a balance of $750.50.' },
  { text: 'The invoice was dated September 30, 2026.' },
  { text: "I can't see that in your reports, so I will pass it to the team." },
  { text: 'A person on the team will read this and reply here.' },
  { text: 'Is this the photo you attached?' },
  { text: 'Which section of the Contact page should it go in?' },
  { text: 'Thanks, Dana. What should the new text say?' },
  { text: 'You can also email support@becomeindelible.com.' },
  { text: 'Your reports are at https://reports.becomeindelible.com/r/abc.' },
  { text: 'Take a look at herbapumps.com/kava-bars.' },
  { text: 'I did not find a page with that name. Could you describe it?' },
  { text: 'Please attach the photo here.' },
  { text: 'Here is what I have. The change is on the Home page, the top banner.' },
  { text: 'Thanks. I have everything I need to pass this to the team.' },
  { text: 'Which of these pages is it?\n1. Home\n2. About\n3. Contact' },
  { text: 'That sounds like a question for the team. I will pass it on.' },
  { text: 'Your site had 1,234 sessions in Google Analytics, Oct 1 to Oct 20, 2026, and 987 people visited.' },
  { text: 'We could not read that file. Could you send it again?' },
  { text: 'Yes, you can attach more than one photo.' },
  { text: 'Would you like to change something before I pass it to the team?' },
  { text: 'The team will review this and reply here.' },
  { text: "Sorry, I can't see that information. A person on the team will follow up." },
  { text: 'Got it, the logo in the footer.' },
  { text: 'Does the new page need a link in the menu?' },
  { text: 'From Google Analytics, Oct 1 to Oct 20, 2026, 600 sessions came to the home page.' },
  { text: 'Is the text on the Services page, or somewhere else?' },
  { text: 'Thanks for the details. Is there anything else on this page?' },
  { text: 'That is outside what I can see here. I will ask the team.' },
  { text: 'I can look at your Search Console numbers. Which dates do you want?' },
  { text: 'Your latest report is ready at https://citadel.becomeindelible.com/portal/retainer.' },
  { text: "We'll review it and reply here." },
  { text: 'I see two photos attached. Which one is for the About page?' },
  { text: 'Thanks. Send the new text whenever you are ready.' },
  { text: 'The balance on your most recent invoice is $750.50 as of September 30, 2026.' },
  { text: 'Which page has the old phone number?' },
  { text: 'Your engagement rate was 46% in Google Analytics, Oct 1 to Oct 20, 2026.' },
  { text: 'Here is a summary. Site: herbapumps.com. Page: Home. Change: swap the banner photo.', kind: 'summary' },
  { text: 'Dear team, please add the new photo to the About page, in the team section, under Dana. The old photo can stay in the library.', kind: 'draft' },
];
