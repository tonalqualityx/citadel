'use client';

/**
 * AddToArcSearch (H9c): one box under the arc. Typing searches the in-view items first (same
 * client first), then his open tasks. Enter picks the highlighted match; Enter on text with no
 * match creates a one-line task and adds it. The last row, "Add ... as a new task", does the
 * same for a tap.
 */
import { useEffect, useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { taskKeys } from '@/lib/api/query-keys';
import { useHomeArcActions } from '@/lib/hooks/use-home';
import type { TaskListResponse } from '@/lib/hooks/use-tasks';
import type { AddToArcSearchProps } from '@/lib/home/types';
import { buildAddOptions, rankCandidates, shouldCreate } from './today-list-logic';

const OPEN_STATUSES = ['not_started', 'in_progress', 'blocked', 'review'];
const DEBOUNCE_MS = 250;
const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]';

export function AddToArcSearch({
  groupKey,
  groupClientId,
  candidates,
  excludeKeys,
  userId,
  onAdd,
  disabled = false,
}: AddToArcSearchProps) {
  const { createAndAddToArc } = useHomeArcActions();
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const [working, setWorking] = useState(false);
  const listId = useId();

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const query = text.trim();
  const searchOn = debounced.length >= 2 && debounced === query;
  const filters = { search: debounced, assignee_id: userId, statuses: OPEN_STATUSES, limit: 8 };
  const remote = useQuery({
    queryKey: taskKeys.list(filters),
    enabled: debounced.length >= 2,
    queryFn: () =>
      apiClient.get<TaskListResponse>('/tasks', {
        params: { search: debounced, assignee_id: userId, statuses: OPEN_STATUSES.join(','), limit: 8 },
      }),
  });
  // Typed text the search has not answered yet: do not create from it until it has.
  const waiting = query.length >= 2 && (!searchOn || remote.isFetching) && !remote.isError;

  const options = useMemo(() => {
    const local = rankCandidates(candidates, query, groupClientId, excludeKeys);
    const hits = searchOn && remote.data ? remote.data.tasks.map((task) => ({ id: task.id, title: task.title })) : [];
    return buildAddOptions(local, hits, excludeKeys);
  }, [candidates, query, groupClientId, excludeKeys, searchOn, remote.data]);

  useEffect(() => setActive(0), [query, options.length]);

  const busy = disabled || working;
  const canCreate = query.length > 0;
  const createIndex = options.length; // the last row

  async function run(work: () => Promise<unknown>) {
    setWorking(true);
    try {
      await work();
      setText('');
      setDebounced('');
    } catch {
      // The hook already showed one plain sentence; keep the text so nothing is lost.
    } finally {
      setWorking(false);
    }
  }

  const pick = (index: number) => {
    const option = options[index];
    if (option) return run(() => onAdd(option.key, option.origin));
    if (canCreate) return run(() => createAndAddToArc(query, userId, groupKey));
  };

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((value) => Math.min(value + 1, canCreate ? createIndex : Math.max(options.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) => Math.max(value - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (busy || !canCreate) return;
      // No match: create, but only once the open-task search has answered.
      if (options.length === 0 && (waiting || !shouldCreate(query, options))) return;
      void pick(Math.min(active, createIndex));
    } else if (event.key === 'Escape') {
      setText('');
    }
  }

  const showList = query.length > 0;

  return (
    <div className="px-3.5 pb-3 pt-2">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Add to today&apos;s arc
      </label>
      <input
        id={`${listId}-input`}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        autoComplete="off"
        value={text}
        disabled={busy}
        placeholder="Add to today's arc: search, or type a new task and press Enter"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className={`w-full min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] px-3 py-2 text-[0.9rem] ${FOCUS}`}
      />
      {showList ? (
        <ul id={listId} role="listbox" aria-label="Matches" className="m-0 mt-1 list-none rounded-lg border border-[var(--border)] bg-[var(--bg-elevated)] p-0">
          {options.map((option, index) => (
            <li
              key={option.key}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={index === 0 ? '' : 'border-t border-[var(--border)]'}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => void pick(index)}
                className={`flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left ${index === active ? 'bg-[var(--accent-subtle)]' : ''} ${FOCUS}`}
              >
                <span className="text-[0.9rem] font-semibold leading-snug">{option.title}</span>
                {option.meta ? <span className="text-[0.8rem] text-[var(--text-secondary)]">{option.meta}</span> : null}
              </button>
            </li>
          ))}
          <li
            id={`${listId}-${createIndex}`}
            role="option"
            aria-selected={active === createIndex}
            className={options.length === 0 ? '' : 'border-t border-[var(--border)]'}
          >
            <button
              type="button"
              disabled={busy || waiting}
              onClick={() => void pick(createIndex)}
              className={`flex w-full min-w-0 flex-col gap-0.5 px-3 py-2 text-left ${active === createIndex ? 'bg-[var(--accent-subtle)]' : ''} ${FOCUS}`}
            >
              <span className="text-[0.9rem] font-semibold leading-snug">Add &ldquo;{query}&rdquo; as a new task</span>
              <span className="text-[0.8rem] text-[var(--text-secondary)]">A one-line task with no date, added as the last step.</span>
            </button>
          </li>
        </ul>
      ) : null}
    </div>
  );
}
