'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { formatRelativeTime } from '@/lib/utils/time';
import { useClientContacts } from '@/lib/hooks/use-client-contacts';
import { useTask } from '@/lib/hooks/use-tasks';
import {
  useApprovalRequestsForTask,
  useCreateApprovalRequest,
  useUpdateApprovalRequest,
  type ApprovalRequest,
  type ApprovalRequestStatus,
} from '@/lib/hooks/use-approval-requests';

interface ApprovalPanelProps {
  taskId: string;
  clientId: string;
}

// Oracle Projects Tab Phase 5 — the client-approval loop's own UI, inside the drawer
// (see ProjectDrawer.tsx's "Client approval" section) for client_approval blockers and
// review blockers. Shows what is being approved, who (a contact picker limited to this
// task's client's own contacts), the editable draft, a queue-to-send action, a status
// timeline, the reply excerpt once one lands, and Mark approved / Request changes /
// Cancel. Never sends anything itself — "queue" only ever stamps status:'queued'; the
// machine-side sender (~/.claude/tools/citadel-approvals/approval-sender.py, cron every
// 5 minutes) is the only thing that ever calls gog.
const STATUS_STEPS: ApprovalRequestStatus[] = ['draft', 'queued', 'sending', 'sent', 'replied', 'approved'];

// MEDIUM-2/MEDIUM-3 fixes. approved/changes_requested/cancelled are TERMINAL — once a
// row reaches one of these, its own story is over: pickActiveRequest below stops
// returning it as the row to work with (so "Draft approval request" becomes available
// again for a fresh round), and it renders in the history list instead of the live
// timeline (so a cancelled or changes-requested row can never be drawn as if every step
// up to and including "Approved" had been reached — see the old `reached` formula this
// replaced, which OR'd in changes_requested/cancelled and lit the whole bar).
const TERMINAL_STATUSES = new Set<ApprovalRequestStatus>(['approved', 'changes_requested', 'cancelled']);

function statusLabel(status: ApprovalRequestStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'queued':
      return 'Queued';
    case 'sending':
      return 'Sending';
    case 'sent':
      return 'Sent';
    case 'replied':
      return 'Replied';
    case 'approved':
      return 'Approved';
    case 'changes_requested':
      return 'Changes requested';
    case 'cancelled':
      return 'Cancelled';
    default:
      return status;
  }
}

/** The row to work with: the most recently created one that hasn't reached a terminal
 * status (draft/queued/sending/sent/replied). A terminal row (approved/
 * changes_requested/cancelled) is never "active" — its story is over, it moves to the
 * history list, and a new draft is always startable once nothing is left in flight. */
function pickActiveRequest(requests: ApprovalRequest[]): ApprovalRequest | null {
  const live = requests.filter((r) => !TERMINAL_STATUSES.has(r.status));
  if (live.length === 0) return null;
  return live[live.length - 1];
}

/** Terminal rows, oldest first (matching the API's own created_at asc ordering) — the
 * history list below the live panel. */
function pickHistoryRequests(requests: ApprovalRequest[]): ApprovalRequest[] {
  return requests.filter((r) => TERMINAL_STATUSES.has(r.status));
}

function historyBadgeColor(status: ApprovalRequestStatus): string {
  if (status === 'approved') return 'var(--success)';
  if (status === 'changes_requested') return 'var(--warning)';
  return 'var(--text-sub)'; // cancelled
}

export function ApprovalPanel({ taskId, clientId }: ApprovalPanelProps) {
  const { data, isLoading } = useApprovalRequestsForTask(taskId);
  const { data: contactsData } = useClientContacts(clientId);
  // "What is being approved" — the task's own staging/deliverable link, when set. Fetched
  // fresh rather than passed in, so the panel works from just a task id (same pattern
  // BlockerRow's submitReply uses for a task's current tags).
  const { data: task } = useTask(taskId);
  const deliverableUrl = task?.staging_preview_url ?? null;
  const createRequest = useCreateApprovalRequest();
  const updateRequest = useUpdateApprovalRequest(taskId);

  const [draftSubject, setDraftSubject] = React.useState('');
  const [draftBody, setDraftBody] = React.useState('');
  const [draftContactId, setDraftContactId] = React.useState('');
  const [changesNote, setChangesNote] = React.useState('');
  const [showChangesInput, setShowChangesInput] = React.useState(false);
  const [seededForId, setSeededForId] = React.useState<string | null>(null);

  const requests = data?.requests ?? [];
  const active = pickActiveRequest(requests);
  const history = pickHistoryRequests(requests);

  // Re-seed the editable draft only when the ACTIVE row changes identity (a new draft
  // created, or the id we're editing changes) — never on every poll tick, same
  // deliberate-single-dependency convention as ProjectDrawer's own next-step draft.
  React.useEffect(() => {
    if (active && active.id !== seededForId) {
      setDraftSubject(active.subject);
      setDraftBody(active.body);
      setDraftContactId(active.contact_id ?? '');
      setSeededForId(active.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const contacts = contactsData?.contacts ?? [];
  const contactOptions = contacts.map((c) => ({ value: c.id, label: c.name ? `${c.name} (${c.email})` : c.email }));

  async function createDraft() {
    try {
      await createRequest.mutateAsync({ task_id: taskId });
    } catch {
      // toasted by the hook
    }
  }

  async function queueToSend() {
    if (!active) return;
    const contact = contacts.find((c) => c.id === draftContactId);
    try {
      await updateRequest.mutateAsync({
        id: active.id,
        data: {
          subject: draftSubject.trim(),
          body: draftBody.trim(),
          to_email: contact?.email ?? active.to_email,
          status: 'queued',
        },
      });
    } catch {
      // toasted by the hook
    }
  }

  async function markApproved() {
    if (!active) return;
    try {
      await updateRequest.mutateAsync({ id: active.id, data: { status: 'approved' } });
    } catch {
      // toasted by the hook
    }
  }

  async function submitRequestChanges() {
    if (!active) return;
    try {
      await updateRequest.mutateAsync({
        id: active.id,
        data: { status: 'changes_requested', reply_note: changesNote.trim() || undefined },
      });
      setChangesNote('');
      setShowChangesInput(false);
    } catch {
      // toasted by the hook
    }
  }

  async function cancelQueued() {
    if (!active) return;
    try {
      await updateRequest.mutateAsync({ id: active.id, data: { status: 'cancelled' } });
    } catch {
      // toasted by the hook
    }
  }

  if (isLoading) {
    return (
      <div data-testid="approval-panel-loading" className="flex items-center gap-2 text-sm text-text-sub">
        <Spinner size="sm" /> Loading approval history…
      </div>
    );
  }

  const canEdit = !!active && active.status === 'draft';
  const canQueue = canEdit && !!draftSubject.trim() && !!draftBody.trim() && (!!draftContactId || !!active?.to_email);
  const canMarkApprovedOrRequestChanges = !!active && (active.status === 'sent' || active.status === 'replied');
  const canCancel = !!active && active.status === 'queued';

  return (
    <div data-testid="approval-panel" className="flex flex-col gap-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text-main">Client approval</h4>
        {active && (
          <span data-testid="approval-panel-status" className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: 'var(--border)' }}>
            {statusLabel(active.status)}
          </span>
        )}
      </div>

      {deliverableUrl && (
        <Link
          href={deliverableUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="approval-panel-deliverable-link"
          className="text-xs font-medium text-primary hover:underline"
        >
          Open what is being approved
        </Link>
      )}

      {!active && (
        <Button size="sm" variant="secondary" onClick={createDraft} disabled={createRequest.isPending}>
          Draft approval request
        </Button>
      )}

      {active && (
        <>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-sub" htmlFor={`approval-contact-${taskId}`}>
              Send to
            </label>
            {canEdit ? (
              <Select
                id={`approval-contact-${taskId}`}
                value={draftContactId}
                onChange={setDraftContactId}
                placeholder={active.to_email ?? 'Select a contact...'}
                options={contactOptions}
              />
            ) : (
              <p className="text-sm text-text-main">{active.to_email ?? active.contact?.email ?? 'No recipient set'}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-sub" htmlFor={`approval-subject-${taskId}`}>
              Subject
            </label>
            {canEdit ? (
              <Input
                id={`approval-subject-${taskId}`}
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
              />
            ) : (
              <p className="text-sm text-text-main">{active.subject}</p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-xs text-text-sub" htmlFor={`approval-body-${taskId}`}>
              Message
            </label>
            {canEdit ? (
              <Textarea
                id={`approval-body-${taskId}`}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={5}
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm text-text-main">{active.body}</p>
            )}
          </div>

          {active.reply_excerpt && (
            <div data-testid="approval-panel-reply-excerpt" className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: 'var(--border)' }}>
              <div className="text-xs text-text-sub">
                Reply {active.replied_at ? formatRelativeTime(active.replied_at) : ''}
              </div>
              <p className="mt-1 text-text-main">{active.reply_excerpt}</p>
            </div>
          )}

          {active.send_error && (
            <p data-testid="approval-panel-send-error" className="text-xs" style={{ color: 'var(--error)' }}>
              {active.send_error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {canEdit && (
              <Button size="sm" variant="primary" onClick={queueToSend} disabled={!canQueue || updateRequest.isPending}>
                Queue to send from my Gmail
              </Button>
            )}
            {canCancel && (
              <Button size="sm" variant="ghost" onClick={cancelQueued} disabled={updateRequest.isPending}>
                Cancel
              </Button>
            )}
            {canMarkApprovedOrRequestChanges && (
              <>
                <Button size="sm" variant="primary" onClick={markApproved} disabled={updateRequest.isPending}>
                  Mark approved
                </Button>
                {!showChangesInput && (
                  <Button size="sm" variant="secondary" onClick={() => setShowChangesInput(true)}>
                    Request changes
                  </Button>
                )}
              </>
            )}
          </div>

          {canMarkApprovedOrRequestChanges && showChangesInput && (
            <div className="flex flex-col gap-2">
              <Textarea
                value={changesNote}
                onChange={(e) => setChangesNote(e.target.value)}
                placeholder="What did the client ask to change?"
                rows={2}
              />
              <div className="flex gap-2">
                <Button size="sm" variant="primary" onClick={submitRequestChanges} disabled={updateRequest.isPending}>
                  Request changes
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowChangesInput(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* MEDIUM-3 fix: active.status is never a terminal one here (pickActiveRequest
              excludes approved/changes_requested/cancelled), so this is always a plain
              in-flight progress bar now — a simple index comparison, no special-casing
              needed for a branch that no longer reaches this render path at all. */}
          <div data-testid="approval-panel-timeline" className="flex flex-wrap items-center gap-1 text-xs text-text-sub">
            {STATUS_STEPS.map((step, idx) => {
              const reached = STATUS_STEPS.indexOf(active.status) >= idx;
              return (
                <span key={step} style={reached ? { color: 'var(--text-main)' } : undefined}>
                  {statusLabel(step)}
                  {idx < STATUS_STEPS.length - 1 ? ' → ' : ''}
                </span>
              );
            })}
          </div>
        </>
      )}

      {history.length > 0 && (
        <div data-testid="approval-panel-history" className="flex flex-col gap-1 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
          <span className="text-xs font-medium text-text-sub">Past approval requests</span>
          {history.map((r) => (
            <div key={r.id} data-testid="approval-panel-history-row" className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate text-text-main">{r.subject}</span>
              <span
                data-testid="approval-panel-history-status"
                className="shrink-0 rounded-full border px-2 py-0.5"
                style={{ borderColor: 'var(--border)', color: historyBadgeColor(r.status) }}
              >
                {statusLabel(r.status)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
