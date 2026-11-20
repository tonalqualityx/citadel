import { describe, it, expect } from 'vitest';
import { buildCommunicationTimeline, type EmailRow, type QuestionRow, type MeetingRow } from '../communication';

const card = { id: 'card-1', title: 'Homepage copy' };

function email(over: Partial<EmailRow> = {}): EmailRow {
  return {
    id: 'e1',
    message_id: 'gm-1',
    rfc_message_id: 'abc@mail.example.com',
    account: 'mike@becomeindelible.com',
    from_name: 'Dan Client',
    from_email: 'dan@example.com',
    subject: 'Re: homepage',
    gist: 'Dan approved the hero.\nSecond line.',
    deep_link: 'https://mail.google.com/mail/u/0/#inbox/18c1',
    received_at: new Date('2026-11-10T10:00:00Z'),
    task: card,
    ...over,
  };
}

function question(over: Partial<QuestionRow> = {}): QuestionRow {
  return {
    id: 'q1',
    question: 'Which photo goes in the hero?',
    state: 'open',
    created_at: new Date('2026-11-11T09:00:00Z'),
    sent_at: null,
    answered_at: null,
    asked_of_contact: null,
    asked_by: { name: 'Bast' },
    asked_by_lane: null,
    task: card,
    ...over,
  };
}

function meeting(over: Partial<MeetingRow> = {}): MeetingRow {
  return {
    id: 'm1',
    title: 'Kickoff call',
    meeting_date: new Date('2026-11-12T15:00:00Z'),
    summary: 'Walked through the sitemap.',
    created_by: { name: 'Mike' },
    ...over,
  };
}

describe('buildCommunicationTimeline', () => {
  it('combines emails, questions and meetings newest first', () => {
    const t = buildCommunicationTimeline({ emails: [email()], questions: [question()], meetings: [meeting()] });
    expect(t.items.map((i) => i.kind)).toEqual(['meeting', 'question', 'email']);
    expect(t.counts).toEqual({ email: 1, question: 1, meeting: 1 });
  });

  it('links each item to its email thread, card or meeting', () => {
    const t = buildCommunicationTimeline({ emails: [email()], questions: [question()], meetings: [meeting()] });
    const byKind = Object.fromEntries(t.items.map((i) => [i.kind, i]));
    expect(byKind.email.href).toBe('https://mail.google.com/mail/u/?authuser=mike%40becomeindelible.com#all/18c1');
    expect(byKind.email.external).toBe(true);
    expect(byKind.email.card).toEqual(card);
    expect(byKind.question.href).toBe('/tasks/card-1');
    expect(byKind.question.external).toBe(false);
    expect(byKind.meeting.href).toBe('/meetings/m1');
    expect(byKind.meeting.card).toBeNull();
  });

  it('shows the mike@ and bast@ copies of one email once, keeping the first received', () => {
    const t = buildCommunicationTimeline({
      emails: [
        email({ id: 'e2', message_id: 'gm-2', account: 'bast@becomeindelible.com', received_at: new Date('2026-11-10T10:00:05Z'), rfc_message_id: 'ABC@mail.example.com' }),
        email(),
      ],
      questions: [],
      meetings: [],
    });
    expect(t.items).toHaveLength(1);
    expect(t.items[0].id).toBe('e1');
    expect(t.counts.email).toBe(1);
  });

  it('keeps the card and links Mike\'s copy when the first copy received is bast@ with no card', () => {
    const t = buildCommunicationTimeline({
      emails: [
        email({ id: 'e2', message_id: 'gm-2', account: 'bast@becomeindelible.com', received_at: new Date('2026-11-10T09:59:58Z'), task: null, deep_link: 'https://mail.google.com/mail/u/0/#inbox/b1' }),
        email(),
      ],
      questions: [],
      meetings: [],
    });
    expect(t.items).toHaveLength(1);
    expect(t.items[0].at).toBe('2026-11-10T09:59:58.000Z');
    expect(t.items[0].card).toEqual(card);
    expect(t.items[0].href).toBe('https://mail.google.com/mail/u/?authuser=mike%40becomeindelible.com#all/18c1');
  });

  it('keeps two emails with no RFC id apart by their Gmail message id', () => {
    const t = buildCommunicationTimeline({
      emails: [email({ rfc_message_id: null }), email({ id: 'e2', message_id: 'gm-2', rfc_message_id: null })],
      questions: [],
      meetings: [],
    });
    expect(t.items).toHaveLength(2);
  });

  it('dates a sent question by when it was sent and says who it was for', () => {
    const t = buildCommunicationTimeline({
      emails: [],
      questions: [
        question({ sent_at: new Date('2026-11-13T08:00:00Z'), asked_of_contact: { name: 'Lisa', email: 'lisa@example.com' }, state: 'answered' }),
        question({ id: 'q2', asked_of_contact: { name: null, email: 'kue@example.com' } }),
        question({ id: 'q3', asked_by: null, asked_by_lane: 'dox' }),
      ],
      meetings: [],
    });
    const [sent, q2, q3] = t.items;
    expect(sent.at).toBe('2026-11-13T08:00:00.000Z');
    expect(sent.detail).toBe('Asked of Lisa, answered');
    expect(sent.state).toBe('answered');
    expect(q2.detail).toBe('Asked of kue@example.com, open');
    expect(q3.detail).toBe('For Mike, open');
    expect(q3.from).toBe('dox');
  });

  it('uses the first non-empty line of a gist or summary, and the sender address when there is no name', () => {
    const t = buildCommunicationTimeline({
      emails: [email({ gist: '\n  \nFirst real line\nmore', from_name: null })],
      questions: [],
      meetings: [meeting({ summary: null })],
    });
    const e = t.items.find((i) => i.kind === 'email')!;
    expect(e.detail).toBe('First real line');
    expect(e.from).toBe('dan@example.com');
    expect(t.items.find((i) => i.kind === 'meeting')!.detail).toBeNull();
  });

  it('lists a meeting once when it is linked to the project and to a card', () => {
    const t = buildCommunicationTimeline({ emails: [], questions: [], meetings: [meeting(), meeting()] });
    expect(t.items).toHaveLength(1);
  });

  it('returns an empty timeline with zero counts', () => {
    expect(buildCommunicationTimeline({ emails: [], questions: [], meetings: [] })).toEqual({
      items: [],
      counts: { email: 0, question: 0, meeting: 0 },
    });
  });
});
