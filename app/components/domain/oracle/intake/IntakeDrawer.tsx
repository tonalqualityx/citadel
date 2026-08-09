'use client';

import * as React from 'react';
import { Archive, CalendarPlus, ChevronDown, ChevronRight, ExternalLink, Plus, StickyNote, X } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerCloseButton,
} from '@/components/ui/drawer';
import type { EmailAsk, WaitingOnMeResponse } from '@/lib/hooks/use-waiting-on-me';
import { useUpdateEmailAsk, useCreateTaskFromEmailAsk } from '@/lib/hooks/use-email-asks';
import { crisisFromLabel } from '@/components/domain/oracle/crisis/crisis-strip-logic';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils/cn';
import {
  intakeChipLine,
  groupAsksByLane,
  laneEmoji,
  formatProposedEvent,
  calendarButtonState,
  collapseAsks,
  collapseSummaryLine,
  type LaneGroup,
  type CollapsedGroup,
} from './intake-drawer-logic';
import { IntakeAttachPicker } from './IntakeAttachPicker';

interface IntakeDrawerProps {
  intake: WaitingOnMeResponse['intake'];
  timezone: string;
}

function TrainingNoteField({ ask }: { ask: EmailAsk }) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [draft, setDraft] = React.useState(ask.training_note ?? '');
  const updateAsk = useUpdateEmailAsk();

  function save() {
    const trimmed = draft.trim();
    updateAsk.mutate({ id: ask.id, data: { training_note: trimmed || null } });
    setIsOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      {ask.training_note && !isOpen && (
        <p className="truncate text-xs italic text-text-sub" data-testid="intake-training-note">
          note: {ask.training_note}
        </p>
      )}
      {isOpen ? (
        <div className="flex items-center gap-1">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setIsOpen(false);
            }}
            placeholder="note for Bast (calibration)..."
            maxLength={2000}
            className="flex-1 rounded border border-border-warm bg-surface px-2 py-1 text-xs text-text-main placeholder:text-text-sub"
            data-testid="intake-training-note-input"
          />
          <Button variant="ghost" size="sm" onClick={save} aria-label="Save note">
            Save
          </Button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex w-fit items-center gap-1 text-xs text-text-sub hover:text-text-main"
        >
          <StickyNote className="h-3 w-3" aria-hidden="true" />
          {ask.training_note ? 'Edit note' : 'Note for Bast'}
        </button>
      )}
    </div>
  );
}

// Clarity Phase 6 — the meeting-lane card's prominent parsed time + Add-to-calendar
// affordance. A pure presentational sub-component (same split as TrainingNoteField above)
// so IntakeDrawer's own return stays readable; all the state-machine logic lives in
// calendarButtonState (intake-drawer-logic.ts) — this only renders whichever of the 4
// states that function returns.
function MeetingEventBlock({ ask, timezone }: { ask: EmailAsk; timezone: string }) {
  const updateAsk = useUpdateEmailAsk();
  const state = calendarButtonState(ask);

  if (state === 'none' || !ask.proposed_event_at) return null;

  return (
    <div className="flex flex-col gap-1" data-testid="meeting-event-block">
      <span className="text-sm font-medium text-text-main" data-testid="meeting-proposed-time">
        {formatProposedEvent(ask.proposed_event_at, ask.proposed_event_minutes, timezone)}
      </span>
      {state === 'add' && (
        <Button
          variant="secondary"
          size="sm"
          className="w-fit"
          data-testid="add-to-calendar-button"
          disabled={updateAsk.isPending}
          onClick={() => updateAsk.mutate({ id: ask.id, data: { calendar_requested: true } })}
        >
          <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" />
          Add to calendar
        </Button>
      )}
      {state === 'queued' && (
        <span className="text-xs text-text-sub" data-testid="calendar-queued-label">
          queued for calendar ⏳
        </span>
      )}
      {state === 'added' && (
        <span className="text-xs text-text-sub" data-testid="calendar-added-label">
          added ✓
        </span>
      )}
    </div>
  );
}

// 2026-08-03 — the collapsed row's activity line plus an opt-in list of what it stands for.
// Mike asked for the count of new items and a note about the most recent one, without
// losing the ability to see the individual messages: "The thing I must see is the
// announcement. The rest is basically fun." So the chorus is present, quiet, and one click
// away rather than occupying 23 rows of the drawer.
function CollapsedMembers({
  group,
  timezone,
}: {
  group: CollapsedGroup<EmailAsk>;
  timezone: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const others = group.items.filter((m) => m.id !== group.anchor.id);

  return (
    <div className="flex flex-col gap-1" data-testid="intake-collapse">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        data-testid="intake-collapse-toggle"
        className="flex items-center gap-1 self-start text-xs text-text-sub hover:text-text-main"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
        {collapseSummaryLine(group, timezone)}
      </button>
      {expanded && (
        <ul className="flex flex-col gap-0.5 border-l border-border-warm pl-2" data-testid="intake-collapse-members">
          {others.map((m) => (
            <li key={m.id} className="flex items-baseline gap-1.5 text-xs text-text-sub">
              <a
                href={m.deep_link}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:text-text-main hover:underline"
              >
                {m.from_name || m.from_email} — {m.subject}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// 2026-08-05 — Mike's ruling: each lane group in the drawer (Admin/Meeting/Sales/General)
// gets its own collapse toggle, plus the lane's icon and count on the header so it reads
// the same shorthand as the trigger chip ("💰 Sales 2"). Groups default OPEN — Mike asked
// for the ability to collapse, not for collapsed-by-default, and existing tests assert
// lane contents are visible on first open. State lives in plain useState here rather than
// CollapsibleGroup (components/domain/oracle/CollapsibleGroup.tsx) — that component's
// existing consumers (SnoozedRow, MachineSection, PipelineLane) hardcode a different
// typographic treatment (bold, monospace, "(count)" suffix) and it has no icon slot, so
// bending it to fit here would either risk their look or bolt on props only this call site
// uses. Same chevron-rotate pattern, purpose-built markup.
//
// Extracted into its own component (same split as TrainingNoteField / MeetingEventBlock /
// CollapsedMembers above) because each lane now needs its own open/closed state — a hook
// can't be called inside the parent's .map() callback. Mirrors those siblings by pulling
// its own mutation hooks directly rather than threading handler props down.
function IntakeLaneSection({ group, timezone }: { group: LaneGroup<EmailAsk>; timezone: string }) {
  const [open, setOpen] = React.useState(true);
  const updateAsk = useUpdateEmailAsk();
  const createTask = useCreateTaskFromEmailAsk();
  const { openTaskPeek } = useTaskPeek();

  function handleDismiss(ask: EmailAsk) {
    updateAsk.mutate({ id: ask.id, data: { state: 'dismissed' } });
  }

  function handleDismissGroup(asks: EmailAsk[]) {
    asks.forEach((a) => updateAsk.mutate({ id: a.id, data: { state: 'dismissed' } }));
  }

  function handleArchiveGroup(asks: EmailAsk[]) {
    asks.forEach((a) => updateAsk.mutate({ id: a.id, data: { state: 'archive_requested' } }));
  }

  function handleArchive(ask: EmailAsk) {
    updateAsk.mutate({ id: ask.id, data: { state: 'archive_requested' } });
  }

  function handleCreate(ask: EmailAsk) {
    createTask.mutate({ id: ask.id });
  }

  async function handleCreateAndOpen(ask: EmailAsk) {
    const task = await createTask.mutateAsync({ id: ask.id });
    openTaskPeek(task.id);
  }

  return (
    <div className="flex flex-col gap-2" data-testid={`intake-lane-${group.lane}`}>
      {/* Heading wraps the button rather than the other way round: <button> takes phrasing
          content only, and the ARIA accordion pattern wants the control INSIDE the heading
          so heading-navigation lands on a lane and still exposes its expanded state. */}
      <h3 className="self-start">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          data-testid={`intake-lane-toggle-${group.lane}`}
          className="flex items-center gap-1 rounded px-1 py-0.5 text-xs font-medium uppercase tracking-wide text-text-sub hover:bg-background-light/50"
        >
          <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} aria-hidden="true" />
          {laneEmoji(group.lane)} {group.label} {group.asks.length}
        </button>
      </h3>
      {open && (
        <div className="flex flex-col gap-2">
          {collapseAsks(group.asks).map((collapsed) => {
            // The anchor carries the signal: a conversation's OPENING message,
            // or a recurring report's LATEST instalment. Every per-message
            // affordance below acts on it; the resolve actions act on the
            // whole group.
            const ask = collapsed.anchor;
            return (
              <Card key={collapsed.key} className="flex flex-col gap-1.5 p-3" data-testid="intake-card">
                <span className="truncate text-xs text-text-sub">{crisisFromLabel(ask)}</span>
                <p className="truncate text-sm font-medium text-text-main">{ask.subject}</p>
                {ask.gist && <p className="truncate text-xs text-text-sub">{ask.gist}</p>}
                {collapsed.total > 1 && <CollapsedMembers group={collapsed} timezone={timezone} />}

                {group.lane === 'meeting' && <MeetingEventBlock ask={ask} timezone={timezone} />}

                <TrainingNoteField ask={ask} />

                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Button asChild variant="secondary" size="sm">
                    <a href={ask.deep_link} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                      Open email
                    </a>
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handleCreate(ask)}
                    disabled={createTask.isPending}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    {group.lane === 'sales' ? 'Create lead quest' : 'Create'}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleCreateAndOpen(ask)}
                    disabled={createTask.isPending}
                  >
                    {group.lane === 'sales' ? 'Create lead quest + open' : 'Create + open'}
                  </Button>
                  <Tooltip
                    content={
                      collapsed.total > 1
                        ? `Files all ${collapsed.total} messages for the classifier to archive in Gmail later`
                        : 'Files this email for the classifier to archive in Gmail later'
                    }
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        collapsed.total > 1 ? handleArchiveGroup(collapsed.items) : handleArchive(ask)
                      }
                      disabled={updateAsk.isPending}
                      aria-label="Archive"
                    >
                      <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                      {collapsed.total > 1 ? `Archive all ${collapsed.total}` : 'Archive'}
                    </Button>
                  </Tooltip>
                  <Tooltip
                    content={
                      collapsed.total > 1
                        ? `Dismiss — clears all ${collapsed.total} messages from Intake with no other action`
                        : 'Dismiss — clears this from Intake with no other action'
                    }
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        collapsed.total > 1 ? handleDismissGroup(collapsed.items) : handleDismiss(ask)
                      }
                      disabled={updateAsk.isPending}
                      aria-label="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </Tooltip>
                </div>
                <IntakeAttachPicker askId={ask.id} />
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Clarity Phase 4b — Mike's ruling: Intake relocated out of the main column entirely (was a
// large in-page expandable section under Needs Reshi) into a compact clickable trigger up
// in the header, opening a slide-over drawer — the SAME Drawer/Sheet pattern the quest peek
// already uses (components/ui/drawer.tsx), reused as-is. Nothing intake-related renders in
// the main column anymore; OracleHeader mounts this directly, under the week capacity
// strip. Renders even when count is 0 (a quiet "nothing waiting" line inside the drawer),
// unlike the crisis strip's exception-only zero-pixels rule — the trigger chip is a stable,
// always-there landmark.
export function IntakeDrawer({ intake, timezone }: IntakeDrawerProps) {
  const [open, setOpen] = React.useState(false);
  // The shared Drawer/DrawerContent primitives use Radix's `forceMount` (see
  // components/ui/drawer.tsx) so a drawer can animate ITSELF closed via CSS rather than
  // vanishing instantly — but that means its Dialog.Content stays in the DOM permanently
  // once mounted, registering its own Escape-key DismissableLayer the whole time. With the
  // quest-peek drawer ALSO permanently mounted on this same page (TaskPeekProvider), two
  // simultaneous forceMount Dialog.Content layers caused Escape to sometimes get routed to
  // the wrong one (closing/no-oping the wrong drawer) even while this one had never been
  // opened. Lazy-mounting this Drawer behind `hasOpened` — only rendering it after the
  // trigger's first click — avoids ever having two of these layers registered at once
  // unless Mike has actually opened Intake, which is the rare case.
  const [hasOpened, setHasOpened] = React.useState(false);

  // Clarity Phase 6 — lane groups (Meeting, Sales, General order, empty lanes skipped).
  const laneGroups = groupAsksByLane(intake.items);

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setHasOpened(true);
          setOpen(true);
        }}
        data-testid="intake-drawer-trigger"
        className="rounded-full border border-border-warm bg-surface px-2.5 py-1 text-xs text-text-sub hover:bg-background-light hover:text-text-main"
      >
        {intakeChipLine(intake.lanes)}
      </button>

      {hasOpened && (
        <Drawer open={open} onOpenChange={setOpen}>
          <DrawerContent side="right" size="lg" data-testid="intake-drawer">
            <DrawerHeader>
              <DrawerTitle>Intake</DrawerTitle>
              <DrawerCloseButton />
            </DrawerHeader>
            <DrawerBody>
              <div className="flex flex-col gap-3" data-testid="intake-cards">
                {intake.items.length === 0 ? (
                  <p className="px-1 text-sm text-text-sub">Nothing waiting.</p>
                ) : (
                  laneGroups.map((group) => (
                    <IntakeLaneSection key={group.lane} group={group} timezone={timezone} />
                  ))
                )}
              </div>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
