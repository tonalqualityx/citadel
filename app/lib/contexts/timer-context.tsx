'use client';

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiClient } from '@/lib/api/client';

interface TimerState {
  isRunning: boolean;
  taskId: string | null;
  taskTitle: string | null;
  projectId: string | null;
  projectName: string | null;
  startedAt: Date | null;
  elapsedSeconds: number;
  timeEntryId: string | null;
}

interface TimerContextValue extends TimerState {
  startTimer: (taskId: string, taskTitle: string, projectId?: string | null, projectName?: string | null) => Promise<void>;
  stopTimer: () => Promise<void>;
  cancelTimer: () => Promise<void>;
  isLoading: boolean;
}

const TimerContext = createContext<TimerContextValue | null>(null);

const initialState: TimerState = {
  isRunning: false,
  taskId: null,
  taskTitle: null,
  projectId: null,
  projectName: null,
  startedAt: null,
  elapsedSeconds: 0,
  timeEntryId: null,
};

export function TimerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<TimerState>(initialState);
  const [isLoading, setIsLoading] = useState(false);

  // Load active timer on mount
  useEffect(() => {
    async function loadActiveTimer() {
      try {
        const response = await apiClient.get<{ timer: any }>('/time-entries/active');
        if (response.timer) {
          const startedAt = new Date(response.timer.started_at);
          const elapsed = Math.floor((Date.now() - startedAt.getTime()) / 1000);
          setState({
            isRunning: true,
            taskId: response.timer.task_id,
            taskTitle: response.timer.task?.title || 'Untitled Task',
            projectId: response.timer.project_id,
            projectName: response.timer.project?.name || null,
            startedAt,
            elapsedSeconds: elapsed,
            timeEntryId: response.timer.id,
          });
        }
      } catch (error) {
        // No active timer or not logged in - that's fine
        console.debug('No active timer found');
      }
    }
    loadActiveTimer();
  }, []);

  // Update elapsed time every second
  useEffect(() => {
    if (!state.isRunning || !state.startedAt) return;

    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.startedAt!.getTime()) / 1000);
      setState((prev) => ({ ...prev, elapsedSeconds: elapsed }));
    }, 1000);

    return () => clearInterval(interval);
  }, [state.isRunning, state.startedAt]);

  const startTimer = useCallback(async (
    taskId: string,
    taskTitle: string,
    projectId?: string | null,
    projectName?: string | null
  ) => {
    setIsLoading(true);
    try {
      // Stop any existing timer first (handled by API)
      const response = await apiClient.post<{ timer: any }>('/time-entries/start', {
        task_id: taskId,
        project_id: projectId,
      });

      setState({
        isRunning: true,
        taskId,
        taskTitle,
        projectId: projectId || null,
        projectName: projectName || null,
        startedAt: new Date(response.timer.started_at),
        elapsedSeconds: 0,
        timeEntryId: response.timer.id,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  const stopTimer = useCallback(async () => {
    if (!state.timeEntryId) return;

    setIsLoading(true);
    try {
      await apiClient.post(`/time-entries/${state.timeEntryId}/stop`);
      setState(initialState);
    } finally {
      setIsLoading(false);
    }
  }, [state.timeEntryId]);

  const cancelTimer = useCallback(async () => {
    if (!state.timeEntryId) return;

    setIsLoading(true);
    try {
      await apiClient.delete(`/time-entries/${state.timeEntryId}`);
      setState(initialState);
    } finally {
      setIsLoading(false);
    }
  }, [state.timeEntryId]);

  return (
    <TimerContext.Provider value={{ ...state, startTimer, stopTimer, cancelTimer, isLoading }}>
      {children}
    </TimerContext.Provider>
  );
}

export function useTimer() {
  const context = useContext(TimerContext);
  if (!context) {
    throw new Error('useTimer must be used within TimerProvider');
  }
  return context;
}
