'use client';

/**
 * ArcEditor (H9c): the arc's steps. Drag the grip to reorder (pointer or keyboard through
 * dnd-kit), or use Move up / Move down under More. "Remove from arc" sits under More; the
 * toast with Undo comes from the caller's onAct. Order is shown at once and reset to the
 * server's order when the steps prop changes.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { ArcEditorProps } from '@/lib/home/types';
import type { HomeItem } from '@/lib/home/types';
import { moveIndex, moveKey, orderSteps, rowMeta, sameOrder } from './today-list-logic';

interface StepRowProps {
  item: HomeItem;
  index: number;
  count: number;
  selected: boolean;
  disabled: boolean;
  onSelect: (item: HomeItem) => void;
  onMove: (key: string, direction: -1 | 1) => void;
  onRemove: (key: string) => void;
}

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';
const SMALL_BTN = `min-h-[36px] rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-1 text-[0.85rem] font-semibold disabled:opacity-50 ${FOCUS}`;

function StepRow({ item, index, count, selected, disabled, onSelect, onMove, onRemove }: StepRowProps) {
  const [open, setOpen] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
    disabled,
  });
  const meta = rowMeta(item);
  const menuId = `arc-more-${item.key}`;
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-step-key={item.key}
      className={`border-t border-[var(--border)] ${isDragging ? 'relative z-10 opacity-60' : ''}`}
    >
      <div className="flex items-stretch">
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={`Reorder: ${item.title}. Press space, then the arrow keys.`}
          className={`flex w-9 shrink-0 cursor-grab items-center justify-center text-[var(--text-muted)] active:cursor-grabbing disabled:cursor-default ${FOCUS}`}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onSelect(item)}
          aria-current={selected ? 'true' : 'false'}
          className={`flex min-w-0 flex-1 flex-col gap-0.5 border-l-[3px] py-[11px] pr-2 pl-2 text-left ${
            selected ? 'border-l-[var(--accent)] bg-[var(--accent-subtle)]' : 'border-l-transparent'
          } ${FOCUS}`}
        >
          <strong className="text-[0.93rem] font-semibold leading-snug">{item.title}</strong>
          {meta ? <span className="text-[0.8rem] text-[var(--text-secondary)]">{meta}</span> : null}
        </button>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls={menuId}
          aria-label={`More for: ${item.title}`}
          className={`shrink-0 px-3 text-[0.85rem] font-semibold text-[var(--text-secondary)] ${FOCUS}`}
        >
          More
        </button>
      </div>
      {open ? (
        <div id={menuId} className="flex flex-wrap gap-2 px-3 pb-3 pl-9">
          <button type="button" disabled={disabled || index === 0} onClick={() => onMove(item.key, -1)} className={SMALL_BTN}>
            Move up
          </button>
          <button type="button" disabled={disabled || index === count - 1} onClick={() => onMove(item.key, 1)} className={SMALL_BTN}>
            Move down
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setOpen(false);
              onRemove(item.key);
            }}
            className={SMALL_BTN}
          >
            Remove from arc
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function ArcEditor({ steps, selectedKey, onSelect, onReorder, onRemove, disabled = false }: ArcEditorProps) {
  const serverKeys = useMemo(() => steps.map((step) => step.key), [steps]);
  const serverSignature = serverKeys.join('|');
  const [keys, setKeys] = useState<string[]>(serverKeys);
  useEffect(() => {
    setKeys(serverKeys);
    // The signature is the real dependency; serverKeys is rebuilt on every render of the parent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSignature]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordered = useMemo(() => orderSteps(steps, keys), [steps, keys]);
  const orderedKeys = ordered.map((step) => step.key);

  function commit(next: string[]) {
    if (sameOrder(next, orderedKeys)) return;
    setKeys(next);
    onReorder(next);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    commit(moveIndex(orderedKeys, orderedKeys.indexOf(String(active.id)), orderedKeys.indexOf(String(over.id))));
  }

  if (ordered.length === 0) return null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={orderedKeys} strategy={verticalListSortingStrategy}>
        <ul className="m-0 list-none p-0" aria-label="Steps in today's arc">
          {ordered.map((item, index) => (
            <StepRow
              key={item.key}
              item={item}
              index={index}
              count={ordered.length}
              selected={item.key === selectedKey}
              disabled={disabled}
              onSelect={onSelect}
              onMove={(key, direction) => commit(moveKey(orderedKeys, key, direction))}
              onRemove={onRemove}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
