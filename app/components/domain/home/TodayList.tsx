'use client';

/**
 * TodayList (H9c): the left pane when the Today tile is selected. "Quick, before you start",
 * then "Today's arc: {name}" (ArcEditor, then the add box), then the day foot: the size line,
 * "Why this arc", "Lighter today" and "Swap arc" with its choices. It posts through `onAct`
 * and never fetches by itself (the add box's search and create go through use-home hooks).
 */
import { useState } from 'react';
import type { HomeArcChoice, HomeItem, TodayListProps } from '@/lib/home/types';
import { AddToArcSearch } from './AddToArcSearch';
import { ArcEditor } from './ArcEditor';
import { QUICK_HEADING, arcHeading, dayOverflows, rowMeta, whyLine } from './today-list-logic';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const BTN = `min-h-[40px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3.5 py-2 text-[0.9rem] font-semibold disabled:opacity-55 ${FOCUS}`;
const GROUP = 'border-t border-[var(--border)] px-3.5 pb-1.5 pt-3 text-[0.72rem] font-bold uppercase tracking-[0.05em] text-[var(--text-muted)] first:border-t-0';

function QuickRow({ item, selected, onSelect }: { item: HomeItem; selected: boolean; onSelect: (item: HomeItem) => void }) {
  const meta = rowMeta(item);
  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      aria-current={selected ? 'true' : 'false'}
      className={`flex w-full min-w-0 flex-col gap-0.5 border-l-[3px] px-3.5 py-[11px] text-left ${
        selected ? 'border-l-[var(--accent)] bg-[var(--accent-subtle)]' : 'border-l-transparent'
      } ${FOCUS}`}
    >
      <strong className="text-[0.93rem] font-semibold leading-snug">{item.title}</strong>
      {meta ? <span className="text-[0.8rem] text-[var(--text-secondary)]">{meta}</span> : null}
    </button>
  );
}

export function TodayList({
  today,
  emptyText,
  selectedKey,
  onSelect,
  addCandidates,
  userId,
  onAct,
  busy = false,
}: TodayListProps) {
  const [swapOpen, setSwapOpen] = useState(false);
  // Bumped when a reorder fails, so the editor falls back to the server's order.
  const [editorReset, setEditorReset] = useState(0);

  if (!today) {
    return <p className="m-0 px-3.5 py-4 text-[0.9rem] text-[var(--text-secondary)]">{emptyText}</p>;
  }

  const groupKey = today.group_key;
  const overflow = dayOverflows(today.minutes_total, today.minutes_free);
  const why = whyLine(today.why);

  const swapTo = (choice: HomeArcChoice) => {
    setSwapOpen(false);
    onAct({ action: 'swap', to_group_key: choice.group_key }).catch(() => undefined);
  };

  return (
    <div className="flex min-w-0 flex-col">
      {today.quick.length > 0 ? (
        <>
          <h3 className={GROUP}>{QUICK_HEADING}</h3>
          {today.quick.map((item) => (
            <QuickRow key={item.key} item={item} selected={item.key === selectedKey} onSelect={onSelect} />
          ))}
        </>
      ) : null}

      <h3 className={GROUP}>{arcHeading(today.arc_name)}</h3>
      <ArcEditor
        key={editorReset}
        groupKey={groupKey}
        steps={today.steps}
        addedKeys={today.added_keys}
        selectedKey={selectedKey}
        onSelect={onSelect}
        disabled={busy}
        onReorder={(stepKeys) => {
          onAct({ action: 'arc_reorder', group_key: groupKey, step_keys: stepKeys }).catch(() => setEditorReset((n) => n + 1));
        }}
        onRemove={(itemKey) => {
          onAct({ action: 'arc_remove', item_key: itemKey, group_key: groupKey }).catch(() => undefined);
        }}
      />
      <AddToArcSearch
        groupKey={groupKey}
        groupClientId={today.client?.id ?? null}
        candidates={addCandidates}
        excludeKeys={today.steps.map((step) => step.key)}
        userId={userId}
        disabled={busy}
        onAdd={(itemKey, origin) => onAct({ action: 'arc_add', item_key: itemKey, group_key: groupKey, origin })}
      />

      <div className="flex flex-col gap-2 border-t border-[var(--border)] px-3.5 pb-3.5 pt-3 text-[0.85rem]">
        <p
          className={`m-0 ${overflow ? 'border-l-[3px] border-[var(--warning-line)] pl-2' : ''}`}
          data-overflow={overflow ? 'true' : 'false'}
        >
          {today.size_line}
        </p>
        {why ? <p className="m-0 text-[var(--text-secondary)]">{why}</p> : null}
        <div className="flex flex-wrap gap-2">
          {today.lighter ? (
            <button
              type="button"
              disabled={busy}
              className={BTN}
              onClick={() => {
                setSwapOpen(false);
                onAct({ action: 'lighter', to_group_key: today.lighter!.group_key }).catch(() => undefined);
              }}
            >
              Lighter today
            </button>
          ) : null}
          {today.swap.length > 0 ? (
            <button
              type="button"
              className={BTN}
              aria-expanded={swapOpen}
              aria-controls="today-swap-choices"
              onClick={() => setSwapOpen((open) => !open)}
            >
              Swap arc
            </button>
          ) : null}
        </div>
        {swapOpen ? (
          <div id="today-swap-choices" className="flex flex-col gap-1.5">
            {today.swap.map((choice) => (
              <button
                key={choice.group_key}
                type="button"
                disabled={busy}
                onClick={() => swapTo(choice)}
                className={`flex w-full min-w-0 flex-col gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-left disabled:opacity-55 ${FOCUS}`}
              >
                <span>
                  <strong>{choice.name}.</strong> {choice.why}
                </span>
                <span className="text-[0.8rem] text-[var(--text-secondary)]">{choice.effort}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
