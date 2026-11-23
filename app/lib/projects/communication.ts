/**
 * A project's communication timeline (Mike, 2026-11-19: "I'd love to potentially see a record of all communication related to
 * a project on a tab on the project screen. ... It could also link to meetings where project items were discussed.").
 *
 * One list, newest first, of three kinds of record:
 * - email: an EmailAsk filed to the project, or to one of its cards (email_asks.task_id). The mike@ and bast@ copies of one
 *   message share an RFC Message-ID and are shown once. Links to the Gmail thread.
 * - question: a TaskQuestion on one of the project's cards (a question we sent a client, or one for Mike), never a withdrawn
 *   one, never one on a Triage card (the same rule as GET /api/questions). Links to the card.
 * - meeting: a meeting linked to the project (meeting_projects), or one a project card came from (tasks.meeting_id). Links to
 *   the meeting.
 */
import { prisma } from '@/lib/db/prisma';
import { normalizeGmailDeepLink } from '@/lib/email-asks';

export type CommunicationKind = 'email' | 'question' | 'meeting';

export interface CommunicationCard {
  id: string;
  title: string;
}

export interface CommunicationItem {
  kind: CommunicationKind;
  id: string;
  at: string;
  title: string;
  /** One line under the title: the email's gist, who the question is for and its state, the meeting summary. */
  detail: string | null;
  /** Who it came from: the sender of an email, who asked a question, who logged a meeting. */
  from: string | null;
  /** Where the item opens: the Gmail thread, the card, or the meeting. */
  href: string;
  external: boolean;
  card: CommunicationCard | null;
  /** question only: open, answered or defaulted. */
  state?: string;
}

export interface CommunicationTimeline {
  items: CommunicationItem[];
  counts: Record<CommunicationKind, number>;
}

export interface EmailRow {
  id: string;
  message_id: string;
  rfc_message_id: string | null;
  account: string;
  from_name: string | null;
  from_email: string;
  subject: string;
  gist: string | null;
  deep_link: string;
  received_at: Date;
  task: CommunicationCard | null;
}

export interface QuestionRow {
  id: string;
  question: string;
  state: string;
  created_at: Date;
  sent_at: Date | null;
  answered_at: Date | null;
  asked_of_contact: { name: string | null; email: string } | null;
  asked_by: { name: string } | null;
  asked_by_lane: string | null;
  /** Null for a project question (asked on the project itself): it opens on the project's Questions tab. */
  task: CommunicationCard | null;
  project_id?: string | null;
}

export interface MeetingRow {
  id: string;
  title: string;
  meeting_date: Date;
  summary: string | null;
  created_by: { name: string } | null;
}

/** The mailbox whose Gmail link opens for Mike when a message has several copies. */
const MIKE_MAILBOX = 'mike@becomeindelible.com';

const KIND_ORDER: Record<CommunicationKind, number> = { email: 0, question: 1, meeting: 2 };

function firstLine(text: string | null, max = 200): string | null {
  if (!text) return null;
  const line = text.split('\n').map((l) => l.trim()).find(Boolean);
  if (!line) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function questionDetail(q: QuestionRow): string {
  const forWhom = q.asked_of_contact ? `Asked of ${q.asked_of_contact.name || q.asked_of_contact.email}` : 'For Mike';
  return `${forWhom}, ${q.state}`;
}

/** Combine the three kinds into one list, newest first. Pure: the route and the tests share it. */
export function buildCommunicationTimeline(rows: { emails: EmailRow[]; questions: QuestionRow[]; meetings: MeetingRow[] }): CommunicationTimeline {
  // One message can sit in several mailboxes (the mike@ and bast@ copies share an RFC Message-ID). Show it once: dated by the
  // first copy received, linked to Mike's copy when there is one, and carrying a card if any copy was filed to one.
  const groups = new Map<string, EmailRow[]>();
  for (const e of rows.emails) {
    const key = e.rfc_message_id ? `rfc:${e.rfc_message_id.toLowerCase()}` : `msg:${e.message_id}`;
    const group = groups.get(key);
    if (group) group.push(e);
    else groups.set(key, [e]);
  }
  const emails: CommunicationItem[] = [];
  for (const copies of groups.values()) {
    copies.sort((a, b) => a.received_at.getTime() - b.received_at.getTime() || a.id.localeCompare(b.id));
    const first = copies[0];
    const linked = copies.find((c) => c.account === MIKE_MAILBOX) ?? first;
    emails.push({
      kind: 'email',
      id: first.id,
      at: first.received_at.toISOString(),
      title: first.subject || '(no subject)',
      detail: firstLine(first.gist ?? copies.find((c) => c.gist)?.gist ?? null),
      from: first.from_name || first.from_email,
      href: normalizeGmailDeepLink(linked.deep_link, linked.account),
      external: true,
      card: copies.find((c) => c.task)?.task ?? null,
    });
  }

  const questions: CommunicationItem[] = rows.questions.map((q) => ({
    kind: 'question',
    id: q.id,
    at: (q.sent_at ?? q.created_at).toISOString(),
    title: q.question,
    detail: questionDetail(q),
    from: q.asked_by?.name ?? q.asked_by_lane ?? null,
    href: q.task ? `/tasks/${q.task.id}` : `/projects/${q.project_id ?? ''}`,
    external: false,
    card: q.task,
    state: q.state,
  }));

  const meetingIds = new Set<string>();
  const meetings: CommunicationItem[] = [];
  for (const m of rows.meetings) {
    if (meetingIds.has(m.id)) continue;
    meetingIds.add(m.id);
    meetings.push({
      kind: 'meeting',
      id: m.id,
      at: m.meeting_date.toISOString(),
      title: m.title,
      detail: firstLine(m.summary),
      from: m.created_by?.name ?? null,
      href: `/meetings/${m.id}`,
      external: false,
      card: null,
    });
  }

  const items = [...emails, ...questions, ...meetings].sort(
    (a, b) => b.at.localeCompare(a.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  );
  return { items, counts: { email: emails.length, question: questions.length, meeting: meetings.length } };
}

const CARD_SELECT = { id: true, title: true } as const;

/** Read the project's emails, questions and meetings and combine them. The caller has already checked the project exists. */
export async function loadProjectCommunication(projectId: string): Promise<CommunicationTimeline> {
  const [emails, questions, meetings] = await Promise.all([
    prisma.emailAsk.findMany({
      where: { OR: [{ project_id: projectId }, { task: { project_id: projectId, is_deleted: false } }] },
      select: {
        id: true,
        message_id: true,
        rfc_message_id: true,
        account: true,
        from_name: true,
        from_email: true,
        subject: true,
        gist: true,
        deep_link: true,
        received_at: true,
        task: { select: { ...CARD_SELECT, is_deleted: true } },
      },
    }),
    prisma.taskQuestion.findMany({
      where: { state: { not: 'withdrawn' }, OR: [{ task: { project_id: projectId, is_deleted: false, status: { not: 'triage' } } }, { project_id: projectId, task_id: null }] },
      select: {
        id: true,
        question: true,
        state: true,
        created_at: true,
        sent_at: true,
        answered_at: true,
        asked_by_user_id: true,
        asked_by_lane: true,
        asked_of_contact: { select: { name: true, email: true } },
        project_id: true,
        task: { select: CARD_SELECT },
      },
    }),
    prisma.meeting.findMany({
      where: {
        is_deleted: false,
        OR: [{ meeting_projects: { some: { project_id: projectId } } }, { tasks: { some: { project_id: projectId, is_deleted: false } } }],
      },
      select: { id: true, title: true, meeting_date: true, summary: true, created_by: { select: { name: true } } },
    }),
  ]);

  // TaskQuestion carries the asker as a bare id (no relation), so read the names in one query.
  const askerIds = [...new Set(questions.map((q) => q.asked_by_user_id).filter((v): v is string => !!v))];
  const askers = askerIds.length ? await prisma.user.findMany({ where: { id: { in: askerIds } }, select: { id: true, name: true } }) : [];
  const askerName = new Map(askers.map((u) => [u.id, u.name]));

  return buildCommunicationTimeline({
    // An email filed to the project can still point at a card that was deleted since: keep the email, drop the dead card link.
    emails: emails.map((e) => ({ ...e, task: e.task && !e.task.is_deleted ? { id: e.task.id, title: e.task.title } : null })),
    questions: questions.map((q) => {
      const name = q.asked_by_user_id ? askerName.get(q.asked_by_user_id) : undefined;
      return { ...q, asked_by: name ? { name } : null };
    }),
    meetings,
  });
}
