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
import type { OracleProjectCard } from '@/lib/hooks/use-oracle-projects';
import { BlockerRow } from './BlockerRow';
import { NotesLog } from './NotesLog';
import { EmailSummary } from './EmailSummary';
import { PickToArcDialog } from './PickToArcDialog';
import type { Blocker } from '@/lib/oracle/projects/blockers';

interface ProjectDrawerProps {
  project: OracleProjectCard | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Oracle Projects Tab Phase 4 — the drawer: next step (editable/refreshable), blockers,
// notes log, email summary, and a collapsed dismissed-items section (Phase 5 populates
// it — dismissal isn't wired yet, so it's an honest placeholder, not a fake list).
export function ProjectDrawer({ project, open, onOpenChange }: ProjectDrawerProps) {
  const [editing, setEditing] = React.useState(false);
  const [draftText, setDraftText] = React.useState('');
  const [draftOwnerId, setDraftOwnerId] = React.useState<string | null>(null);
  const [pickBlocker, setPickBlocker] = React.useState<Blocker | null>(null);

  const overrideNextStep = useOverrideNextStep(project?.id ?? '');
  const clearOverride = useClearNextStepOverride(project?.id ?? '');
  const refresh = useRefreshNextStep(project?.id ?? '');

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

  async function saveOverride() {
    if (!draftText.trim()) return;
    await overrideNextStep.mutateAsync(
      draftOwnerId ? { text: draftText.trim(), owner_id: draftOwnerId } : { text: draftText.trim() }
    );
    setEditing(false);
  }

  async function clear() {
    await clearOverride.mutateAsync();
    setEditing(false);
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
                      <BlockerRow key={blocker.id} blocker={blocker} onPick={setPickBlocker} />
                    ))}
                  </div>
                )}
              </section>

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
                trigger={<h3 className="text-sm font-semibold text-text-main">Dismissed items</h3>}
              >
                <p className="text-sm text-text-sub">Dismissing blockers is coming in the next pass.</p>
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
