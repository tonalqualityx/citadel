'use client';

/**
 * Client hooks for the Home screen (Slice 1, plan task H9a). Components import only from here.
 *
 * What a component needs:
 * - useHome(): the one GET /api/home query. It never refetches on window focus, on reconnect
 *   or on an interval (nothing may reorder while he is looking); it refetches only when an
 *   action below succeeds (or partly succeeds).
 * - useHomeItemAction(opts): `run(action, item, runOpts?)` for every button (ItemCard
 *   onAction), plus `done(item)` and `stop(item, note)` for WorkingOnBar, and per-item state
 *   for ItemCard: `pendingFor(item)` (pendingAction), `statusFor(item)` (statusText) and
 *   `promptFor(item)` (prompt, the "Switch to this one?" question after a 409 pin_conflict).
 * - useHomeAct(): `(request, opts?) => Promise<HomeActResponse>`, the TodayList `onAct` prop.
 *   Toasts the server's line with Undo, refetches, and on failure shows ONE plain sentence
 *   and rejects (the screen stays as it was). A pin_conflict is not toasted; it rejects so the
 *   caller can ask and resend with switch: true (see isPinConflict).
 * - useHomeArcActions(): addToArc, removeFromArc, reorderArc, swapArc, lighterToday and
 *   createAndAddToArc, each wrapping useHomeAct with the right request (ArcEditor onReorder /
 *   onRemove, AddToArcSearch onAdd).
 * - useHomeUndo(): `(actionId) => Promise<boolean>`; posts /api/home/undo, toasts, refetches.
 * - Helpers: HOME_KEYS, postHomeAct, postHomeUndo, isPinConflict, HOME_PIN_SWITCH_TEXT,
 *   HOME_FAILURE_TEXT, HOME_PIN_CONFIRM_LABEL, HOME_PIN_CANCEL_LABEL.
 *
 * Known gap: apiClient throws `new Error(body.error)` and drops the body's `code`, so a
 * pin_conflict is recognised by its exact server sentence (isPinConflict), not by its code.
 * Existing-endpoint actions call apiClient directly (the same endpoints useUpdateTask,
 * useUpdateEmailAsk and useUpdateWait use) instead of those hooks, because those hooks toast
 * their own error and useUpdateTask needs the TimerProvider; the screen must show one sentence.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api/client';
import { taskKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  HomeActRequest,
  HomeActResponse,
  HomeActionId,
  HomeArcAddOrigin,
  HomeCardPrompt,
  HomeItem,
  HomeRecordedActionId,
  HomeResponse,
  HomeUndoRequest,
  HomeUndoResponse,
} from '@/lib/home/types';

export const HOME_KEYS = {
  all: ['home'] as const,
  screen: ['home', 'screen'] as const,
};

/** The server's exact pin_conflict sentence (types.ts HomeActErrorBody). */
export const HOME_PIN_SWITCH_TEXT = 'Switch to this one? The other goes back to its place.';
export const HOME_PIN_CONFIRM_LABEL = 'Switch';
export const HOME_PIN_CANCEL_LABEL = 'Keep the first';
/** The one sentence shown when any action fails. */
export const HOME_FAILURE_TEXT = "That didn't go through. Nothing on the screen changed.";
const UNDO_FAILURE_TEXT = "That couldn't be undone.";
const UNDO_DURATION_MS = 10_000;

/** True when an error from the act route is the 409 pin_conflict (matched by its sentence; see file note). */
export function isPinConflict(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const e = error as { code?: unknown; message?: unknown };
    if (e.code === 'pin_conflict') return true;
    if (typeof e.message === 'string' && e.message.startsWith('Switch to this one?')) return true;
  }
  return false;
}

export function postHomeAct(request: HomeActRequest): Promise<HomeActResponse> {
  return apiClient.post<HomeActResponse>('/home/act', request);
}

export function postHomeUndo(actionId: string): Promise<HomeUndoResponse> {
  const body: HomeUndoRequest = { action_id: actionId };
  return apiClient.post<HomeUndoResponse>('/home/undo', body);
}

/** GET /api/home. No focus, reconnect or interval refetch; only an action refetches it. */
export function useHome() {
  return useQuery({
    queryKey: HOME_KEYS.screen,
    queryFn: () => apiClient.get<HomeResponse>('/home'),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: Infinity,
    retry: 1,
  });
}

async function refetchHome(queryClient: QueryClient): Promise<void> {
  try {
    await queryClient.refetchQueries({ queryKey: HOME_KEYS.all });
  } catch {
    // The old screen stays; nothing to add.
  }
}

function invalidateOtherSurfaces(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
  queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  queryClient.invalidateQueries({ queryKey: ['waiting-on-me'] });
  queryClient.invalidateQueries({ queryKey: ['waits'] });
}

async function recordQuietly(item: HomeItem, did: HomeRecordedActionId, undo = false) {
  try {
    await postHomeAct({ action: 'record', item_key: item.key, did, ...(undo ? { undo: true } : {}) });
  } catch {
    // The measure is best effort; the action itself already worked.
  }
}

// ---------------------------------------------------------------------------
// useHomeUndo
// ---------------------------------------------------------------------------

/**
 * `(actionId) => Promise<boolean>`: undo a home-only action, toast, refetch. The toast reads "Undone." for his own
 * actions; the keeper's lines pass `{ doneText: 'Put back.' }`.
 */
export function useHomeUndo(opts: { doneText?: string } = {}) {
  const doneText = opts.doneText ?? 'Undone.';
  const queryClient = useQueryClient();
  return useCallback(
    async (actionId: string): Promise<boolean> => {
      try {
        await postHomeUndo(actionId);
      } catch {
        showToast.error(UNDO_FAILURE_TEXT);
        return false;
      }
      showToast.success(doneText);
      await refetchHome(queryClient);
      return true;
    },
    [queryClient, doneText],
  );
}

// ---------------------------------------------------------------------------
// useHomeAct
// ---------------------------------------------------------------------------

export interface HomeActOptions {
  /** Skip the success toast (the caller shows its own line). Default false. */
  quiet?: boolean;
}

/**
 * `(request, opts?) => Promise<HomeActResponse>`. Success: toast the server's line (with Undo
 * while undo_until is set), refetch /api/home, resolve. Failure: one plain sentence (none for
 * pin_conflict) and the error is rethrown, so the screen is unchanged.
 */
export function useHomeAct() {
  const queryClient = useQueryClient();
  const undo = useHomeUndo();
  return useCallback(
    async (request: HomeActRequest, opts: HomeActOptions = {}): Promise<HomeActResponse> => {
      let res: HomeActResponse;
      try {
        res = await postHomeAct(request);
      } catch (error) {
        if (!isPinConflict(error)) showToast.error(HOME_FAILURE_TEXT);
        throw error;
      }
      if (!opts.quiet && request.action !== 'record') {
        const line = res.message ?? 'Done.';
        if (res.undo_until) {
          showToast.success(line, {
            action: { label: 'Undo', onClick: () => void undo(res.action_id) },
            duration: UNDO_DURATION_MS,
          });
        } else {
          showToast.success(line);
        }
      }
      await refetchHome(queryClient);
      return res;
    },
    [queryClient, undo],
  );
}

// ---------------------------------------------------------------------------
// useHomeArcActions
// ---------------------------------------------------------------------------

export interface HomeArcActions {
  /** Add one item as the last step (AddToArcSearch onAdd, "Add to today's arc"). */
  addToArc: (itemKey: string, groupKey: string, origin: HomeArcAddOrigin) => Promise<HomeActResponse>;
  /** Remove one step (ArcEditor onRemove). */
  removeFromArc: (itemKey: string, groupKey: string) => Promise<HomeActResponse>;
  /** Send the full new order (ArcEditor onReorder). */
  reorderArc: (groupKey: string, stepKeys: string[]) => Promise<HomeActResponse>;
  /** Swap arc to one of today.swap (its group_key). */
  swapArc: (toGroupKey: string) => Promise<HomeActResponse>;
  /** Lighter today: pass today.lighter.group_key. */
  lighterToday: (toGroupKey: string) => Promise<HomeActResponse>;
  /**
   * Create a one-line task (POST /api/tasks, title and assignee_id only), then arc_add it with
   * origin 'created'. Resolves with the add's response. If the task was created but the add
   * failed, the toast says so and the error is rethrown.
   */
  createAndAddToArc: (title: string, userId: string, groupKey: string) => Promise<HomeActResponse>;
}

export function useHomeArcActions(): HomeArcActions {
  const act = useHomeAct();
  const queryClient = useQueryClient();
  return useMemo<HomeArcActions>(
    () => ({
      addToArc: (itemKey, groupKey, origin) =>
        act({ action: 'arc_add', item_key: itemKey, group_key: groupKey, origin }),
      removeFromArc: (itemKey, groupKey) => act({ action: 'arc_remove', item_key: itemKey, group_key: groupKey }),
      reorderArc: (groupKey, stepKeys) => act({ action: 'arc_reorder', group_key: groupKey, step_keys: stepKeys }),
      swapArc: (toGroupKey) => act({ action: 'swap', to_group_key: toGroupKey }),
      lighterToday: (toGroupKey) => act({ action: 'lighter', to_group_key: toGroupKey }),
      createAndAddToArc: async (title, userId, groupKey) => {
        const text = title.trim();
        let created: { id: string };
        try {
          created = await apiClient.post<{ id: string }>('/tasks', { title: text, assignee_id: userId });
        } catch (error) {
          showToast.error(HOME_FAILURE_TEXT);
          throw error;
        }
        queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
        try {
          return await act({ action: 'arc_add', item_key: `task:${created.id.toLowerCase()}`, group_key: groupKey, origin: 'created' }, { quiet: true });
        } catch (error) {
          // act already showed the failure sentence; add what is true about the task.
          showToast.error('The task was created, but it was not added to today’s arc.');
          throw error;
        }
      },
    }),
    [act, queryClient],
  );
}

// ---------------------------------------------------------------------------
// useHomeItemAction
// ---------------------------------------------------------------------------

export interface HomeItemActionOptions {
  /** Opens the task peek drawer (TaskPeekProvider) for open_task and a link-less open_wait. */
  openTask?: (taskId: string) => void;
}

export interface HomeRunOptions {
  /** Resend of do_now after "Switch to this one?" was confirmed. */
  switch?: boolean;
  /** Today's group_key; required only for add_to_arc and remove_from_arc. */
  groupKey?: string;
  /** Note for stop (default ''). */
  note?: string | null;
}

export interface HomeItemActionApi {
  /** Run one button. Resolves true when it worked (or only navigated), false when it failed or was paused for a question. */
  run: (action: { id: HomeActionId; href?: string | null }, item: HomeItem, opts?: HomeRunOptions) => Promise<boolean>;
  /** WorkingOnBar onDone: the item's done path (existing endpoint, then done_pin). */
  done: (item: HomeItem) => Promise<boolean>;
  /** WorkingOnBar onStop: "Stop for now" with the note. */
  stop: (item: HomeItem, note: string) => Promise<boolean>;
  /** ItemCard pendingAction for this item, or null. */
  pendingFor: (item: HomeItem | null) => HomeActionId | null;
  /** ItemCard statusText for this item (quiet line after a failure), or null. */
  statusFor: (item: HomeItem | null) => string | null;
  /** ItemCard prompt for this item (the pin switch question), or null. */
  promptFor: (item: HomeItem | null) => HomeCardPrompt | null;
  /** True while any action is in flight. */
  busy: boolean;
}

type ItemState = { key: string; action: HomeActionId } | null;

export function useHomeItemAction(options: HomeItemActionOptions = {}): HomeItemActionApi {
  const queryClient = useQueryClient();
  const router = useRouter();
  const act = useHomeAct();
  const openTaskRef = useRef(options.openTask);
  openTaskRef.current = options.openTask;

  const [pending, setPending] = useState<ItemState>(null);
  const [status, setStatus] = useState<{ key: string; text: string } | null>(null);
  const [pinAsk, setPinAsk] = useState<string | null>(null); // item key awaiting the switch answer

  const patchTask = (id: string, data: Record<string, unknown>) => apiClient.patch(`/tasks/${id}`, data);

  const finish = useCallback(
    async (item: HomeItem, did: HomeRecordedActionId, undoFn?: () => Promise<void>, line = 'Done.') => {
      invalidateOtherSurfaces(queryClient);
      void recordQuietly(item, did);
      if (undoFn) {
        showToast.success(line, {
          action: {
            label: 'Undo',
            onClick: () => {
              undoFn()
                .then(async () => {
                  await recordQuietly(item, did, true);
                  invalidateOtherSurfaces(queryClient);
                  await refetchHome(queryClient);
                })
                .catch(() => showToast.error(UNDO_FAILURE_TEXT));
            },
          },
          duration: UNDO_DURATION_MS,
        });
      } else {
        showToast.success(line);
      }
      await refetchHome(queryClient);
    },
    [queryClient],
  );

  const execute = useCallback(
    async (action: { id: HomeActionId; href?: string | null }, item: HomeItem, opts: HomeRunOptions): Promise<boolean> => {
      const src = item.source;
      switch (action.id) {
        case 'done': {
          const previous = src.task_status ?? 'not_started';
          await patchTask(src.id, { status: 'done' });
          if (item.pinned) {
            try {
              await postHomeAct({ action: 'done_pin', item_key: item.key });
            } catch {
              // Task is done; the pin is cleared on the next day roll. Not worth failing the action.
            }
          }
          await finish(item, 'done', () => patchTask(src.id, { status: previous }).then(() => undefined), 'Marked done.');
          return true;
        }
        case 'do_now': {
          // Decision 4: pin first; only a successful pin may touch the task.
          await postHomeAct({ action: 'pin', item_key: item.key, ...(opts.switch ? { switch: true } : {}) });
          if (src.kind === 'task') await patchTask(src.id, { status: 'in_progress' });
          await finish(item, 'do_now', undefined, 'Working on it now.');
          return true;
        }
        case 'let_it_go':
          await patchTask(src.id, { status: 'abandoned' });
          await finish(item, 'let_it_go', undefined, 'Let go.');
          return true;
        case 'approve_all': {
          try {
            for (const id of src.ids) await patchTask(id, { approved: true });
          } catch (error) {
            // Some pieces may be approved already: show the true state before reporting.
            invalidateOtherSurfaces(queryClient);
            await refetchHome(queryClient);
            throw error;
          }
          await finish(item, 'approve_all', undefined, 'Approved.');
          return true;
        }
        case 'approve_wait':
        case 'complete_wait': {
          const resolution = action.id === 'approve_wait' ? 'approved' : 'completed';
          await apiClient.patch(`/waits/${src.id}`, { action: 'resolve', resolution });
          await finish(item, action.id, undefined, action.id === 'approve_wait' ? 'Approved.' : 'Marked done.');
          return true;
        }
        case 'no_reply_needed': {
          const ids = src.ids.length ? src.ids : [src.id];
          for (const id of ids) await apiClient.patch(`/email-asks/${id}`, { state: 'dismissed' });
          await finish(
            item,
            'no_reply_needed',
            async () => {
              for (const id of ids) await apiClient.patch(`/email-asks/${id}`, { state: 'open' });
            },
            'Marked no reply needed.',
          );
          return true;
        }
        case 'handled': {
          await apiClient.patch(`/email-asks/${src.id}`, { state: 'handled' });
          await finish(
            item,
            'handled',
            async () => {
              await apiClient.patch(`/email-asks/${src.id}`, { state: 'open' });
            },
            'Marked handled.',
          );
          return true;
        }
        case 'open_task':
        case 'open_wait':
        case 'open_session':
        case 'open_draft':
        case 'open_thread': {
          const href = action.href ?? null;
          if (href) {
            if (href.startsWith('/')) router.push(href);
            else window.open(href, '_blank', 'noopener,noreferrer');
          } else {
            const taskId = item.opened.task_id;
            if (taskId && openTaskRef.current) openTaskRef.current(taskId);
          }
          void recordQuietly(item, action.id);
          return true;
        }
        case 'not_now':
          await act({ action: 'not_now', item_key: item.key });
          return true;
        case 'matters_more':
          await act({ action: 'matters_more', item_key: item.key });
          return true;
        case 'not_emergency':
          await act({ action: 'not_emergency', item_key: item.key });
          return true;
        case 'stop':
          await act({ action: 'stop', item_key: item.key, note: opts.note ?? '' });
          return true;
        case 'add_to_arc':
          if (!opts.groupKey) throw new Error('missing group key');
          await act({ action: 'arc_add', item_key: item.key, group_key: opts.groupKey, origin: 'in_view' });
          return true;
        case 'remove_from_arc':
          if (!opts.groupKey) throw new Error('missing group key');
          await act({ action: 'arc_remove', item_key: item.key, group_key: opts.groupKey });
          return true;
        default:
          return false;
      }
    },
    [act, finish, queryClient, router],
  );

  const run = useCallback(
    async (action: { id: HomeActionId; href?: string | null }, item: HomeItem, opts: HomeRunOptions = {}) => {
      setPending({ key: item.key, action: action.id });
      setStatus(null);
      setPinAsk(null);
      try {
        return await execute(action, item, opts);
      } catch (error) {
        if (action.id === 'do_now' && isPinConflict(error)) {
          setPinAsk(item.key);
          return false;
        }
        // Home-only actions already toasted through useHomeAct; the rest toast here.
        const alreadyToasted = ['not_now', 'matters_more', 'not_emergency', 'stop', 'add_to_arc', 'remove_from_arc'].includes(action.id);
        if (!alreadyToasted) showToast.error(HOME_FAILURE_TEXT);
        setStatus({ key: item.key, text: HOME_FAILURE_TEXT });
        return false;
      } finally {
        setPending(null);
      }
    },
    [execute],
  );

  const done = useCallback((item: HomeItem) => run({ id: 'done' }, item), [run]);
  const stop = useCallback((item: HomeItem, note: string) => run({ id: 'stop' }, item, { note }), [run]);

  const pendingFor = useCallback(
    (item: HomeItem | null) => (item && pending && pending.key === item.key ? pending.action : null),
    [pending],
  );
  const statusFor = useCallback(
    (item: HomeItem | null) => (item && status && status.key === item.key ? status.text : null),
    [status],
  );
  const promptFor = useCallback(
    (item: HomeItem | null): HomeCardPrompt | null => {
      if (!item || pinAsk !== item.key) return null;
      return {
        text: HOME_PIN_SWITCH_TEXT,
        confirmLabel: HOME_PIN_CONFIRM_LABEL,
        cancelLabel: HOME_PIN_CANCEL_LABEL,
        onConfirm: () => void run({ id: 'do_now' }, item, { switch: true }),
        onCancel: () => setPinAsk(null),
      };
    },
    [pinAsk, run],
  );

  return { run, done, stop, pendingFor, statusFor, promptFor, busy: pending !== null };
}
