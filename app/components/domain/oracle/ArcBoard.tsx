'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Pencil, Plus, ExternalLink, Handshake, Mail, CalendarClock } from 'lucide-react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragStartEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import { cn } from '@/lib/utils/cn';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Avatar } from '@/components/ui/avatar';
import { Tooltip } from '@/components/ui/tooltip';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useNow } from '@/lib/hooks/use-now';
import { useTaskPeek } from '@/lib/contexts/task-peek-context';
import { useQueryClient } from '@tanstack/react-query';
import {
  useArc,
  useArcContext,
  arcKeys,
  useUpdateArcEstimate,
  useUpdateArcNextTouch,
  useCloseArc,
  type ArcTask,
  type ArcDetail,
} from '@/lib/hooks/use-arcs';
import { useUpdateTaskStatus, useCreateTask } from '@/lib/hooks/use-tasks';
import { getArcStatus, getArcProgressPercent } from '@/lib/arc-status';
import { capColumnCards, isWithinColumnLimit } from '@/lib/kanban-caps';
import { arcEstimateDisplay, nextTouchInputValue, isNextTouchOverdue } from './arc-board-logic';
import { ArcSessionPanel } from './ArcSessionPanel';

interface ArcBoardProps {
  arcId: string;
}

type ColumnId = 'not_started' | 'in_progress' | 'review' | 'done';

const COLUMNS: { id: ColumnId; title: string }[] = [
  { id: 'not_started', title: 'Not started' },
  { id: 'in_progress', title: 'In progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
];

// `blocked` renders as a chip on the card, not its own column (existing repo convention —
// see CharterKanban's 'ready' bucket) — it's grouped visually with Not started here.
function columnForTask(task: ArcTask): ColumnId {
  if (task.status === 'blocked') return 'not_started';
  if (task.status === 'abandoned') return 'done';
  return (task.status as ColumnId) ?? 'not_started';
}

// Never a 0%-guilt display: quiet (muted) below ~50%, gains presence (accent, fuller
// opacity) as completion nears 100 — no red anywhere in this bar, ever.
function ProgressBar({ percent }: { percent: number }) {
  const quiet = percent < 50;
  return (
    <div className="flex items-center gap-2" data-testid="arc-progress-bar" data-percent={percent}>
      <div className="h-2 w-40 overflow-hidden rounded-full bg-background-light">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${percent}%`,
            backgroundColor: quiet ? 'var(--text-muted)' : 'var(--accent)',
            opacity: quiet ? 0.45 : 0.6 + (0.4 * (percent - 50)) / 50,
          }}
        />
      </div>
      <span className="text-xs text-text-sub">{percent}%</span>
    </div>
  );
}

// Clarity Phase 4c — the arc board header's time estimate: the sum of the arc's open
// tasks' estimated_minutes, unless Mike has hand-set an override (then the override wins
// and reads "(set by hand)"). A quiet pencil affordance opens a minimal inline form (one
// number input, same "toggle + inline form" pattern as QuickAddQuest below) to set/clear
// that override — the spec's PATCH support with no in-app way to invoke it would leave
// the feature API-only, which isn't the point of "set by hand".
function EstimateBadge({
  arcId,
  estimatedMinutesTotal,
  overrideMinutes,
}: {
  arcId: string;
  estimatedMinutesTotal: number;
  overrideMinutes: number | null;
}) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(overrideMinutes != null ? String(overrideMinutes) : '');
  const updateEstimate = useUpdateArcEstimate();
  const display = arcEstimateDisplay(estimatedMinutesTotal, overrideMinutes);

  function openEditor() {
    setValue(overrideMinutes != null ? String(overrideMinutes) : '');
    setEditing(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const minutes = value.trim() === '' ? null : Number(value);
    if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0)) return;
    updateEstimate.mutate({ id: arcId, minutes }, { onSuccess: () => setEditing(false) });
  }

  function clear() {
    updateEstimate.mutate({ id: arcId, minutes: null }, { onSuccess: () => setEditing(false) });
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={openEditor}
        className="flex items-center gap-1 text-xs text-text-sub hover:text-text-main"
        data-testid="arc-estimate-badge"
        data-is-override={display.isOverride || undefined}
      >
        {display.text}
        <Pencil className="h-3 w-3" aria-hidden="true" />
      </button>
    );
  }

  return (
    <form
      onSubmit={save}
      className="flex items-center gap-1.5 rounded-lg border border-border-warm bg-surface p-1.5"
      data-testid="arc-estimate-form"
    >
      <input
        autoFocus
        type="number"
        min={0}
        inputMode="numeric"
        placeholder="minutes"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="w-20 rounded border border-border-warm bg-surface px-2 py-1 text-xs text-text-main"
        data-testid="arc-estimate-input"
      />
      <Button type="submit" variant="primary" size="sm" disabled={updateEstimate.isPending}>
        Save
      </Button>
      {overrideMinutes != null && (
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={updateEstimate.isPending}>
          Clear
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

export function ArcBoard({ arcId }: ArcBoardProps) {
  const { t } = useTerminology();
  const { data: arc, isLoading, isError } = useArc(arcId);
  const updateStatus = useUpdateTaskStatus();
  const closeArc = useCloseArc();
  const queryClient = useQueryClient();
  const [activeTask, setActiveTask] = React.useState<ArcTask | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const tasksByColumn = React.useMemo(() => {
    const cols: Record<ColumnId, ArcTask[]> = { not_started: [], in_progress: [], review: [], done: [] };
    for (const task of arc?.tasks ?? []) {
      cols[columnForTask(task)].push(task);
    }
    return cols;
  }, [arc?.tasks]);

  function handleDragStart(event: DragStartEvent) {
    const task = arc?.tasks.find((tk) => tk.id === event.active.id);
    setActiveTask(task ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveTask(null);
    const { active, over } = event;
    if (!over || !arc) return;

    const taskId = active.id as string;
    const targetColumn = over.id as ColumnId;
    const task = arc.tasks.find((tk) => tk.id === taskId);
    if (!task) return;
    if (columnForTask(task) === targetColumn) return;

    updateStatus.mutate(
      { id: taskId, status: targetColumn },
      { onSuccess: () => queryClient.invalidateQueries({ queryKey: arcKeys.detail(arcId) }) }
    );
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (isError || !arc) {
    return <div className="py-12 text-center text-sm text-text-sub">Failed to load this arc.</div>;
  }

  const percent = getArcProgressPercent(arc.tasks);
  const status = arc.status ?? getArcStatus({ closed_at: arc.closed_at ? new Date(arc.closed_at) : null, tasks: arc.tasks as any });

  if (!isWithinColumnLimit(COLUMNS.length)) {
    // Guard rail, not expected to fire — the binding kanban cap is 4 columns and this board
    // always renders exactly 4.
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href="/oracle"
        className="flex w-fit items-center gap-1.5 text-sm text-text-sub hover:text-text-main"
        data-testid="arc-board-back-link"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Seeing Stone
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-text-main">{arc.name}</h1>
          <p className="text-xs text-text-sub">
            {status} · {arc.tasks.length} {arc.tasks.length === 1 ? t('task') : t('tasks')}
            {arc.client && ` · ${arc.client.name}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <NextTouchPanel arcId={arcId} nextTouch={arc.next_touch} />
          <EstimateBadge
            arcId={arcId}
            estimatedMinutesTotal={arc.estimated_minutes_total}
            overrideMinutes={arc.estimate_override_minutes}
          />
          <ProgressBar percent={percent} />
          <QuickAddQuest arcId={arcId} />
          {/* Clarity Phase 7 (P2) — wires the existing (previously unused) useCloseArc
              hook: a trivially-reachable close/reopen affordance, and the completion
              nudge's other trigger point (spec Q12) alongside task status transitions. */}
          <Tooltip content={arc.closed_at ? 'Reopens this arc so it surfaces on active views again' : 'Marks this arc done — no more open work expected'}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => closeArc.mutate({ id: arcId, close: !arc.closed_at })}
              disabled={closeArc.isPending}
              data-testid="arc-board-close-toggle"
            >
              {arc.closed_at ? 'Reopen arc' : 'Close arc'}
            </Button>
          </Tooltip>
        </div>
      </div>

      <AccordPanel arc={arc} />
      <EmailAsksPanel emailAsks={arc.email_asks} />

      <ArcSessionPanel sessions={arc.sessions} />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {COLUMNS.map((col) => (
            <ArcColumn key={col.id} id={col.id} title={col.title} tasks={tasksByColumn[col.id]} />
          ))}
        </div>
        <DragOverlay>{activeTask && <ArcTaskCard task={activeTask} isOverlay />}</DragOverlay>
      </DndContext>
    </div>
  );
}

function ArcColumn({ id, title, tasks }: { id: ColumnId; title: string; tasks: ArcTask[] }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const { visible, overflowCount } = capColumnCards(tasks);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex min-h-[10rem] flex-col gap-2 rounded-lg border p-2',
        'border-border-warm bg-background-light/40',
        isOver && 'border-[color:var(--accent)]'
      )}
      data-testid={`arc-column-${id}`}
    >
      <div className="flex items-center justify-between px-1">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-text-sub">{title}</h4>
        <span className="rounded-full border border-border-warm bg-surface px-2 text-xs text-text-sub">
          {tasks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {visible.map((task) => (
          <ArcTaskCard key={task.id} task={task} />
        ))}
      </div>
      {overflowCount > 0 && (
        <div className="px-1 text-center text-xs text-text-sub">+ {overflowCount} more</div>
      )}
    </div>
  );
}

function ArcTaskCard({ task, isOverlay }: { task: ArcTask; isOverlay?: boolean }) {
  const { openTaskPeek } = useTaskPeek();
  const pendingReview = task.status === 'done' && task.needs_review && !task.approved;

  return (
    <DraggableCard id={task.id} disabled={isOverlay}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => openTaskPeek(task.id)}
          className="line-clamp-2 text-left text-sm font-medium text-text-main hover:text-primary"
          data-testid="arc-task-card-title"
        >
          {task.title}
        </button>
        <AssigneeChip assignee={task.assignee} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        {task.status === 'blocked' && <Badge variant="warning" size="sm">Blocked</Badge>}
        {task.status === 'abandoned' && <Badge variant="default" size="sm">Abandoned</Badge>}
        {pendingReview && <Badge variant="warning" size="sm">Awaiting review</Badge>}
      </div>
    </DraggableCard>
  );
}

// Clarity Phase 4c — every task card on the arc board shows its assignee (Mike's and
// Bast's alike — both are plain User rows, no special-casing needed): an avatar/initials
// chip with the full name on hover (native title tooltip). Unassigned renders a quiet,
// dashed-outline placeholder rather than nothing, so "every card shows its assignee" holds
// even for the empty state — it never implies a person exists that doesn't.
function AssigneeChip({ assignee }: { assignee: ArcTask['assignee'] }) {
  if (!assignee) {
    return (
      <span
        title="Unassigned"
        data-testid="arc-task-assignee-chip"
        data-unassigned="true"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-warm text-[0.625rem] text-text-sub"
      >
        ?
      </span>
    );
  }

  return (
    <span title={assignee.name} data-testid="arc-task-assignee-chip" className="shrink-0">
      <Avatar name={assignee.name} size="xs" />
    </span>
  );
}

// Clarity Phase 5 (coordinator addition) — the arc board's "+ Quest" quick-add: a compact
// toggle button opening a minimal inline form (title required, optional due date);
// assignee defaults to the primary operator server-side (see POST /api/tasks's arc_id
// handling). The new quest appears in the To do (not_started) column with no page reload —
// useCreateTask's onSuccess invalidates this same arc's detail query.
function QuickAddQuest({ arcId }: { arcId: string }) {
  const { t } = useTerminology();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [dueDate, setDueDate] = React.useState('');
  const createTask = useCreateTask();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    createTask.mutate(
      {
        title: trimmed,
        arc_id: arcId,
        due_date: dueDate ? new Date(`${dueDate}T00:00:00.000Z`).toISOString() : null,
      },
      {
        onSuccess: () => {
          setTitle('');
          setDueDate('');
          setOpen(false);
        },
      }
    );
  }

  if (!open) {
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} data-testid="arc-board-add-quest-toggle">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" />+ {t('task')}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-border-warm bg-surface p-1.5"
      data-testid="arc-board-add-quest-form"
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={`New ${t('task').toLowerCase()} title…`}
        className="min-w-[10rem] flex-1 rounded border border-border-warm bg-surface px-2 py-1 text-sm text-text-main placeholder:text-text-sub"
        data-testid="arc-board-add-quest-title"
      />
      <input
        type="date"
        value={dueDate}
        onChange={(e) => setDueDate(e.target.value)}
        className="rounded border border-border-warm bg-surface px-2 py-1 text-xs text-text-main"
        data-testid="arc-board-add-quest-due-date"
      />
      <Button type="submit" variant="primary" size="sm" disabled={createTask.isPending || !title.trim()}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </form>
  );
}

// Clarity Phase 3 (Seeing Stone Reckoning) — the arc workspace's accord panel: renders
// only when the arc is linked to a pipeline accord (spec Q4, "the sales-pipeline link").
// Lead name/business/contact + status as PLAIN TEXT (never a stage-editing control — the
// glass never treats accord stage as the tracked thing, per Mike's ruling) + links to
// sibling arcs on the same accord (the "relevant details from earlier rounds" hook),
// read via GET /api/arcs/{id}/context — additive, quiet, no new fetch on the common path
// since useArcContext is only enabled once an accord_id is known.
function AccordPanel({ arc }: { arc: ArcDetail }) {
  const { data: context } = useArcContext(arc.id, { enabled: !!arc.accord_id });
  if (!arc.accord) return null;

  const siblingArcs = context?.accord?.other_arcs ?? [];

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-warm bg-surface p-3" data-testid="arc-accord-panel">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-sub">
        <Handshake className="h-3.5 w-3.5" aria-hidden="true" />
        Pipeline
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
        <span className="font-medium text-text-main">{arc.accord.lead_name ?? arc.accord.name}</span>
        {arc.accord.lead_business_name && (
          <span className="text-text-sub">{arc.accord.lead_business_name}</span>
        )}
        <span className="text-xs capitalize text-text-sub" data-testid="arc-accord-status">
          {arc.accord.status}
        </span>
      </div>
      {(arc.accord.lead_email || arc.accord.lead_phone) && (
        <div className="flex flex-wrap gap-x-3 text-xs text-text-sub">
          {arc.accord.lead_email && <span>{arc.accord.lead_email}</span>}
          {arc.accord.lead_phone && <span>{arc.accord.lead_phone}</span>}
        </div>
      )}
      {siblingArcs.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border-warm pt-2">
          <span className="text-xs text-text-sub">Other arcs on this accord</span>
          <div className="flex flex-wrap gap-2">
            {siblingArcs.map((sibling) => (
              <Link
                key={sibling.id}
                href={`/oracle/arcs/${sibling.id}`}
                className={cn(
                  'rounded-full border border-border-warm px-2 py-0.5 text-xs text-text-sub hover:text-text-main',
                  sibling.closed_at && 'opacity-60'
                )}
                data-testid="arc-sibling-link"
              >
                {sibling.name}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Clarity Phase 3 (Reckoning) — the arc workspace's attached-emails panel (spec Q4:
// "emails attach directly to arcs" — exactly the shapeless-arc case, zero tasks yet, but
// the originating email is what matters most). Renders only when at least one email is
// attached; the deep link opens Gmail directly, same convention as the intake drawer's
// own "Open email" action.
function EmailAsksPanel({ emailAsks }: { emailAsks: ArcDetail['email_asks'] }) {
  if (emailAsks.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-warm bg-surface p-3" data-testid="arc-emails-panel">
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-sub">
        <Mail className="h-3.5 w-3.5" aria-hidden="true" />
        Attached emails
        <span className="rounded-full border border-border-warm bg-background-light px-1.5 text-xs text-text-sub">
          {emailAsks.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {emailAsks.map((ask) => (
          <a
            key={ask.id}
            href={ask.deep_link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex flex-col gap-0.5 rounded border border-border-warm/60 p-2 hover:bg-background-light"
            data-testid="arc-email-ask-item"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-medium text-text-main">{ask.subject}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-sub" aria-hidden="true" />
            </div>
            <span className="truncate text-xs text-text-sub">
              {ask.from_name ?? ask.from_email}
            </span>
            {ask.gist && <span className="truncate text-xs text-text-sub">{ask.gist}</span>}
          </a>
        ))}
      </div>
    </div>
  );
}

// Clarity Phase 3 (Reckoning) — the arc workspace's next-touch panel: display + inline
// edit (spec Q2's "act by" date, distinct from snooze's "hide until"). A quiet warning
// tint marks a past-due date (the anti-drop-net's aging signal) — never a countdown,
// never guilt language, per the DON'T-BUILD list.
function NextTouchPanel({ arcId, nextTouch }: { arcId: string; nextTouch: string | null }) {
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(nextTouchInputValue(nextTouch));
  const updateNextTouch = useUpdateArcNextTouch();
  // Date.now() is an impure call — reading it via useNow (same ticking-clock pattern
  // used elsewhere in this domain) keeps render pure and the overdue flag still fresh.
  const nowMs = useNow(60_000);
  const overdue = isNextTouchOverdue(nextTouch, nowMs);

  function openEditor() {
    setValue(nextTouchInputValue(nextTouch));
    setEditing(true);
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const iso = value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
    updateNextTouch.mutate({ id: arcId, nextTouch: iso }, { onSuccess: () => setEditing(false) });
  }

  function clear() {
    updateNextTouch.mutate({ id: arcId, nextTouch: null }, { onSuccess: () => setEditing(false) });
  }

  if (!editing) {
    return (
      <Tooltip content="When you'll next act on this arc — the anti-drop-net date. Click to set or change it.">
        <button
          type="button"
          onClick={openEditor}
          className={cn(
            'flex items-center gap-1 text-xs hover:text-text-main',
            overdue ? 'font-semibold text-[var(--warning)]' : 'text-text-sub'
          )}
          data-testid="arc-next-touch-badge"
          data-overdue={overdue || undefined}
        >
          <CalendarClock className="h-3 w-3" aria-hidden="true" />
          {nextTouch ? `Next touch ${nextTouchInputValue(nextTouch)}` : 'Set next touch'}
          <Pencil className="h-3 w-3" aria-hidden="true" />
        </button>
      </Tooltip>
    );
  }

  return (
    <form
      onSubmit={save}
      className="flex items-center gap-1.5 rounded-lg border border-border-warm bg-surface p-1.5"
      data-testid="arc-next-touch-form"
    >
      <input
        autoFocus
        type="date"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="rounded border border-border-warm bg-surface px-2 py-1 text-xs text-text-main"
        data-testid="arc-next-touch-input"
      />
      <Button type="submit" variant="primary" size="sm" disabled={updateNextTouch.isPending}>
        Save
      </Button>
      {nextTouch && (
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={updateNextTouch.isPending}>
          Clear
        </Button>
      )}
      <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)}>
        Cancel
      </Button>
    </form>
  );
}

function DraggableCard({ id, disabled, children }: { id: string; disabled?: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id, disabled });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'cursor-grab rounded-lg border border-border-warm bg-surface p-2.5 shadow-sm active:cursor-grabbing',
        isDragging && 'opacity-40'
      )}
    >
      {children}
    </div>
  );
}
