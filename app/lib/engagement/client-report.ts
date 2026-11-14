/**
 * Client report drafts (Dox client reports): what Citadel does when a `client` pass hands in its draft.
 *
 * The draft is a task for Mike, due today (Eastern), tagged `client-report`, holding the Gmail draft link (or a Gmail compose link when the draft could not
 * be made), To, Subject and the body. Mike reviews it and sends it himself: nothing is sent as Mike. Dox gets no new write power: the pass is dry and
 * Citadel makes the task.
 */
import type { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { ApiError } from '@/lib/api/errors';
import { OWED_CHECK } from '@/lib/home/owed/checks';
import { MIKE_USER_ID } from '@/lib/oracle/projects/gate-constants';
import { DOX_USER_ID, isDoxLaneValue } from '@/lib/dox/identity';
import { CLIENT_REPORT_TAG } from '@/lib/dox/guard';
import { computeReportDue, easternDate, reportInstant, reportSetAt } from './report-cadence';
import { reportEmail } from './brief';
import { closeAsksForTasks } from '@/lib/work/ask-closure'; // the one closure of a finished task's emails

export const REPORT_SUBJECT_MAX = 150;
export const REPORT_BODY_MAX = 2000;
export const MIKE_GMAIL_ACCOUNT = 'mike@becomeindelible.com';
const DAY_NAMES: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };

export const clientReportSchema = z
  .object({
    to: z.array(reportEmail).max(10).default([]),
    subject: z.string().trim().min(1).max(REPORT_SUBJECT_MAX),
    body: z.string().trim().min(1).max(REPORT_BODY_MAX),
    gmail_draft_id: z.string().trim().min(1).max(200).optional(),
    gmail_draft_url: z
      .string()
      .trim()
      .max(1000)
      .refine((u) => u.startsWith('https://mail.google.com/'), { message: 'The Gmail draft link must start with https://mail.google.com/' })
      .optional(),
  })
  .strict();
export type ClientReportDraft = z.infer<typeof clientReportSchema>;

/** A Gmail compose window prefilled in Mike's own account. */
export function gmailComposeUrl(d: { to: string[]; subject: string; body: string }, account = MIKE_GMAIL_ACCOUNT): string {
  const q = [`view=cm`, `fs=1`, `authuser=${encodeURIComponent(account)}`, `to=${encodeURIComponent(d.to.join(','))}`, `su=${encodeURIComponent(d.subject)}`, `body=${encodeURIComponent(d.body)}`];
  return `https://mail.google.com/mail/?${q.join('&')}`;
}

const DASH = /[–—]/;
const moneyMatch = (t: string): string | null => {
  for (const re of OWED_CHECK.money) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
};

/** The words of the task description: the link first, then To, Subject and the body. */
export function reportTaskDescription(d: ClientReportDraft): string {
  const link = d.gmail_draft_url
    ? `Open the Gmail draft: ${d.gmail_draft_url}`
    : `Gmail draft could not be made; the text is below. Open it prefilled in Gmail: ${gmailComposeUrl(d)}`;
  return [link, '', `To: ${d.to.length ? d.to.join(', ') : '(the client\'s primary contact; no recipient on file)'}`, `Subject: ${d.subject}`, '', d.body].join('\n');
}

type Db = PrismaClient;
export interface ClientReportPass {
  id: string;
  brief_id: string | null;
  kind: string | null;
  finished_at: Date | null;
  lane: string | null;
  actions: unknown;
}

const refuse = (status: number, code: string, message: string): never => {
  throw new ApiError(message, status, code);
};

/**
 * Make the draft task for a client pass, in one transaction. Returns the task id. Refusals: 409 client_report_pass (not an open client pass started by
 * the Dox lane or a signed-in session), 409 no_report_cadence, 409 report_not_live (brief off or project not live), 409 report_not_due,
 * 409 report_already_drafted, 422 report_money, 422 report_dash.
 */
export async function createClientReportDraft(db: Db, pass: ClientReportPass, draftIn: unknown, now: Date = new Date()): Promise<{ task_id: string }> {
  const draft = clientReportSchema.parse(draftIn);
  if (pass.kind !== 'client' || pass.finished_at || !pass.brief_id) return refuse(409, 'client_report_pass', 'A client report comes from an open client pass.');
  if (pass.lane != null && !isDoxLaneValue(pass.lane)) return refuse(409, 'client_report_pass', 'A client pass is started by Dox or by the owner\'s own session.');
  for (const [what, text] of [['subject', draft.subject], ['body', draft.body]] as const) {
    const m = moneyMatch(text);
    if (m) return refuse(422, 'report_money', `The ${what} mentions money ("${m}"). A client report carries no price or amount.`);
    if (DASH.test(text)) return refuse(422, 'report_dash', `The ${what} has an em or en dash. Rewrite it with a comma, colon or full stop.`);
  }

  return db.$transaction(async (tx) => {
    const brief = await tx.engagementBrief.findUnique({ where: { id: pass.brief_id! } });
    const project = brief?.project_id ? await tx.project.findUnique({ where: { id: brief.project_id }, select: { id: true, name: true, status: true, client_id: true, client: { select: { name: true } } } }) : null;
    if (!brief || !project) return refuse(409, 'client_report_pass', 'This brief has no project.');
    if (brief.report_cadence === 'none') return refuse(409, 'no_report_cadence', 'This project has no client report cadence.');
    if (brief.owner_mode === 'off') return refuse(409, 'report_not_live', 'This brief is off.');
    const state = computeReportDue({
      cadence: brief.report_cadence,
      day: brief.report_day,
      last_report_at: brief.last_report_at ? brief.last_report_at.toISOString() : null,
      set_at: reportSetAt(brief),
      project_status: project.status,
      brief_mode: brief.owner_mode,
      now: now.toISOString(),
    });
    if (state.next_report_on === null) return refuse(409, 'report_not_live', `The project is ${project.status}: no client report is made.`);
    const today = easternDate(now);
    if (!state.due) {
      if (brief.last_report_at && easternDate(brief.last_report_at) === today) return refuse(409, 'report_already_drafted', 'A report was already drafted for this report day.');
      return refuse(409, 'report_not_due', `The next report is due ${state.next_report_on}.`);
    }

    const dayName = DAY_NAMES[brief.report_day ?? ''] ?? 'regular';
    const client = project.client?.name ?? project.name;
    const task = await tx.task.create({
      data: {
        title: `Send ${client} their ${dayName} report`,
        description: reportTaskDescription(draft),
        status: 'not_started',
        assignee_id: MIKE_USER_ID,
        created_by_id: DOX_USER_ID,
        project_id: project.id,
        client_id: project.client_id,
        due_date: new Date(reportInstant(today)),
        tags: [CLIENT_REPORT_TAG],
      },
      select: { id: true },
    });

    const stale = await tx.task.findMany({
      where: { project_id: project.id, tags: { has: CLIENT_REPORT_TAG }, is_deleted: false, status: { in: ['not_started', 'in_progress', 'review', 'blocked'] }, id: { not: task.id } },
      select: { id: true },
    });
    if (stale.length) {
      await tx.task.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: 'abandoned' } });
      await closeAsksForTasks(tx, stale.map((x) => x.id), 'abandoned');
      await tx.comment.createMany({ data: stale.map((s) => ({ task_id: s.id, user_id: DOX_USER_ID, content: "Replaced by this week's draft.", is_internal: true })) });
    }

    const actions = Array.isArray(pass.actions) ? (pass.actions as Prisma.JsonArray) : [];
    await tx.engagementPass.update({
      where: { id: pass.id },
      data: {
        actions: [
          ...actions,
          { kind: 'client_report', task_id: task.id, to: draft.to, subject: draft.subject, body: draft.body, ...(draft.gmail_draft_id ? { gmail_draft_id: draft.gmail_draft_id } : {}), ...(draft.gmail_draft_url ? { gmail_draft_url: draft.gmail_draft_url } : {}) },
        ] as Prisma.InputJsonValue,
      },
    });
    await tx.engagementBrief.update({ where: { id: brief.id }, data: { last_report_at: now } });
    return { task_id: task.id };
  });
}
