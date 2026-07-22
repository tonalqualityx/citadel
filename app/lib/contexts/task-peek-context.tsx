'use client';

import * as React from 'react';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';

// Clarity Phase 4b — Quest Peek View. Mike's ruling: every quest/task-opening action on the
// Seeing Stone opens the existing task-peek drawer on-page instead of navigating away, so he
// can stay on /oracle instead of bouncing between screens. This context owns the single
// shared drawer instance (mirrors the TimerProvider pattern in this same directory) and
// exposes `openTaskPeek(taskId)` to every descendant — AskCard, TodayPickCard, DueSoonRow,
// and IntakeDrawer all call it instead of `<Link>`/`router.push`.
//
// `useTaskPeek()` falls back to a safe no-op instead of throwing when used outside a
// provider — several of those components have their own isolated component tests that
// mount them without a `TaskPeekProvider` wrapper, and this keeps those tests green without
// requiring every one of them to be updated just to satisfy a new required context.

interface TaskPeekContextValue {
  openTaskPeek: (taskId: string) => void;
}

const noopTaskPeek: TaskPeekContextValue = {
  openTaskPeek: () => {
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.warn('useTaskPeek() called outside a TaskPeekProvider — no-op.');
    }
  },
};

const TaskPeekContext = React.createContext<TaskPeekContextValue>(noopTaskPeek);

export function useTaskPeek(): TaskPeekContextValue {
  return React.useContext(TaskPeekContext);
}

export function TaskPeekProvider({ children }: { children: React.ReactNode }) {
  const [peekTaskId, setPeekTaskId] = React.useState<string | null>(null);
  const [isOpen, setIsOpen] = React.useState(false);

  const openTaskPeek = React.useCallback((taskId: string) => {
    setPeekTaskId(taskId);
    setIsOpen(true);
  }, []);

  const value = React.useMemo<TaskPeekContextValue>(() => ({ openTaskPeek }), [openTaskPeek]);

  return (
    <TaskPeekContext.Provider value={value}>
      {children}
      <TaskPeekDrawer taskId={peekTaskId} open={isOpen} onOpenChange={setIsOpen} />
    </TaskPeekContext.Provider>
  );
}
