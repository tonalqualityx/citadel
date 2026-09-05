'use client';

import * as React from 'react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerCloseButton,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Collapsible } from '@/components/ui/collapsible';
import { InlineUserSelect } from '@/components/ui/user-select';
import {
  useOverrideNextStep,
  useClearNextStepOverride,
  useRefreshNextStep,
} from '@/lib/hooks/use-next-step';
import { useUndoBlockerDismissal } from '@/lib/hooks/use-blocker-dismissals';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { formatRelativeTime } from '@/lib/utils/time';
import type { OracleProjectCard } from '@/lib/hooks/use-oracle-projects';
import { BlockerRow } from './BlockerRow';
import { NotesLog } from './NotesLog';
import { EmailSummary } from './EmailSummary';
import { PickToArcDialog } from './PickToArcDialog';
import { ApprovalPanel } from './ApprovalPanel';
import { nextStepSourceSentence, getBlockerTaskId, showsApprovalPanel } from './projects-logic';
import type { Blocker } from '@/lib/oracle/projects/blockers';

interface ProjectDrawerProps {
  project: OracleProjectCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Oracle Projects Tab Phase 4 — the drawer: next step (editable/refreshable), blockers,
// notes log, email summary. Phase 5 adds the Client approval section (ApprovalPanel per
// client_approval/review blocker) and a real Dismissed items list with Undo.
export function ProjectDrawer({ project, open, onOpenChange }: ProjectDrawerProps) {
  const { t } = useTerminology();
  const [editing, setEditing] = React.useState(false);
  const [draftText, setDraftText] = React.useState('');
  const [draftOwnerId, setDraftOwnerId] = React.useState<string | null>(null);
  const [pickBlocker, setPickBlocker] = React.useState<Blocker | null>(null);

  const overrideNextStep = useOverrideNextStep(project?.id ?? '');
  const clearOverride = useClearNextStepOverride(project?.id ?? '');
  const refresh = useRefreshNextStep(project?.id ?? '');
  const undoDismissal = useUndoBlockerDismissal(project?.id ?? '');

  // Re-seed the draft only when the drawer switches to a DIFFERENT project — never on
  // every re-render of the same project's data (the 60s background poll would otherwise
  // blow away in-progress edits mid-typing). Deliberately keyed on project?.id alone.
  React.useEffect(() => {
    if (project) {
      setDraftText(project.next_step.text);
      setDraftOwnerId(project.next_step.owner?.id ?? null);
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  if (!project) return null;

  const isRefreshing = !!project.refresh_requested_at;
  // Phase 5 — one ApprovalPanel per distinct task among the drawer's client_approval/
  // review blockers (never one per blocker: two review blockers can't share a task, but
  // a client_approval blocker and its own task's review blocker, if both present, would
  // otherwise render the same panel twice).
  const approvalTaskIds = Array.from(
    new Set(
      project.blockers
        .filter(showsApprovalPanel)
        .map(getBlockerTaskId)
        .filter((id): id is string => !!id)
    )
  );

  async function saveOverride() {
    if (!draftText.trim()) return;
    try {
      await overrideNextStep.mutateAsync(
        draftOwnerId ? { text: draftText.trim(), owner_id: draftOwnerId } : { text: draftText.trim() }
      );
      setEditing(false);
    } catch {
      // toasted by the hook
    }
  }

  async function clear() {
    try {
      await clearOverride.mutateAsync();
      setEditing(false);
    } catch {
      // toasted by the hook
    }
  }

  return (
    <>
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent side="right" size="lg">
          <DrawerHeader>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-text-sub">
                {project.client.name}
              </div>
              <DrawerTitle>{project.name}</DrawerTitle>
            </div>
            <DrawerCloseButton />
          </DrawerHeader>
          <DrawerBody>
            <div className="flex flex-col gap-6">
              <section data-testid="drawer-next-step">
                <h3 className="mb-2 text-sm font-semibold text-text-main">Next step</h3>
                {!editing ? (
                  <div className="flex flex-col gap-2">
                    <p className="text-sm text-text-main">{project.next_step.text}</p>
                    {nextStepSourceSentence(project.next_step) && (
                      <p data-testid="drawer-next-step-source" className="text-xs text-text-sub">
                        {nextStepSourceSentence(project.next_step)}
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                        Edit
                      </Button>
                      {project.next_step.source === 'mike' && (
                        <Button size="sm" variant="ghost" onClick={clear} disabled={clearOverride.isPending}>
                          Clear override
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => refresh.mutate()}
                        disabled={refresh.isPending || isRefreshing}
                      >
                        {isRefreshing ? 'Refreshing…' : 'Refresh'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    <Textarea
                      value={draftText}
                      onChange={(e) => setDraftText(e.target.value)}
                      rows={2}
                    />
                    <div className="flex items-center gap-2 text-sm">
                      <span className="text-text-sub">Owner:</span>
                      <InlineUserSelect value={draftOwnerId} onChange={setDraftOwnerId} />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={saveOverride}
                        disabled={overrideNextStep.isPending || !draftText.trim()}
                      >
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </section>

              <section data-testid="drawer-blockers">
                <h3 className="mb-2 text-sm font-semibold text-text-main">Blockers</h3>
                {project.blockers.length === 0 ? (
                  <p className="text-sm text-text-sub">No open blockers.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {project.blockers.map((blocker) => (
                      <BlockerRow key={blocker.id} blocker={blocker} projectId={project.id} onPick={setPickBlocker} />
                    ))}
                  </div>
                )}
              </section>

              {approvalTaskIds.length > 0 && (
                <section data-testid="drawer-approvals">
                  <h3 className="mb-2 text-sm font-semibold text-text-main">Client approval</h3>
                  <div className="flex flex-col gap-3">
                    {approvalTaskIds.map((taskId) => (
                      <ApprovalPanel key={taskId} taskId={taskId} clientId={project.client.id} />
                    ))}
                  </div>
                </section>
              )}

              <section data-testid="drawer-notes">
                <h3 className="mb-2 text-sm font-semibold text-text-main">Notes</h3>
                <NotesLog projectId={project.id} />
              </section>

              <section data-testid="drawer-email-summary">
                <h3 className="mb-2 text-sm font-semibold text-text-main">Email summary</h3>
                <EmailSummary
                  summary={project.email_summary}
                  summaryAt={project.email_summary_at}
                  emails={project.linked_emails}
                />
              </section>

              <Collapsible
                trigger={<h3 className="text-sm font-semibold text-text-main">Dismissed items ({project.dismissals.length})</h3>}
              >
                {project.dismissals.length === 0 ? (
                  <p className="text-sm text-text-sub">Nothing dismissed on this {t('project').toLowerCase()}.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {project.dismissals.map((dismissal) => (
                      <div
                        key={dismissal.id}
                        data-testid="dismissed-item"
                        className="flex items-start justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                        style={{ borderColor: 'var(--border)' }}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium uppercase tracking-wide text-text-sub">{dismissal.kind}</div>
                          <div className="text-xs text-text-sub">
                            {dismissal.dismissed_by?.name ?? 'Someone'} · {formatRelativeTime(dismissal.dismissed_at)}
                          </div>
                          {dismissal.note && <div className="mt-1 text-text-main">{dismissal.note}</div>}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => undoDismissal.mutate(dismissal.id)}
                          disabled={undoDismissal.isPending}
                        >
                          Undo
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </Collapsible>
            </div>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {pickBlocker && (
        <PickToArcDialog
          open={!!pickBlocker}
          onOpenChange={(o) => !o && setPickBlocker(null)}
          blocker={pickBlocker}
          project={{ id: project.id, name: project.name }}
        />
      )}
    </>
  );
}
