'use client';

import * as React from 'react';
import { AlertTriangle, Clock, CheckCircle, X, Plus, Square } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useTimeclockIssues,
  useMarkNoTimeNeeded,
  useStopRunningTimer,
  TimeclockIssueTask,
  TimeclockIssueTimer,
} from '@/lib/hooks/use-dashboard';
import { useCreateTimeEntry } from '@/lib/hooks/use-time-entries';
import { DashboardSection } from './dashboard-section';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import { formatElapsedTime } from '@/lib/utils/time';

export function TimeclockIssues() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useTimeclockIssues();
  const markNoTime = useMarkNoTimeNeeded();
  const stopTimer = useStopRunningTimer();
  const createTimeEntry = useCreateTimeEntry();

  // Modal state for adding time
  const [addTimeTask, setAddTimeTask] = React.useState<TimeclockIssueTask | null>(null);
  const [timeMinutes, setTimeMinutes] = React.useState('');

  // Modal state for stopping timer with override
  const [stopTimerEntry, setStopTimerEntry] = React.useState<TimeclockIssueTimer | null>(null);
  const [overrideEndTime, setOverrideEndTime] = React.useState('');

  // Don't show anything if no issues or still loading
  if (isLoading || !data?.hasIssues) {
    return null;
  }

  const handleAddTime = async () => {
    if (!addTimeTask || !timeMinutes) return;

    const minutes = parseInt(timeMinutes, 10);
    if (isNaN(minutes) || minutes <= 0) return;

    try {
      // Create a time entry for the task
      const now = new Date();
      const startedAt = new Date(now.getTime() - minutes * 60 * 1000);

      await createTimeEntry.mutateAsync({
        task_id: addTimeTask.id,
        project_id: addTimeTask.project?.id,
        started_at: startedAt.toISOString(),
        ended_at: now.toISOString(),
        duration: minutes,
        description: 'Time added retroactively',
      });

      // Refresh the timeclock issues list
      await refetch();

      setAddTimeTask(null);
      setTimeMinutes('');
    } catch (error) {
      console.error('Failed to add time:', error);
    }
  };

  const handleMarkNoTime = async (taskId: string) => {
    console.log('[TimeclockIssues] Marking no time needed for task:', taskId);
    try {
      await markNoTime.mutateAsync(taskId);
      console.log('[TimeclockIssues] Successfully marked, refetching...');
      await refetch();
      console.log('[TimeclockIssues] Refetch complete');
    } catch (error) {
      console.error('[TimeclockIssues] Failed to mark no time needed:', error);
    }
  };

  const handleStopTimer = async (entry: TimeclockIssueTimer, useOverride: boolean) => {
    try {
      let endTime: Date | undefined;

      if (useOverride && overrideEndTime) {
        endTime = new Date(overrideEndTime);
      }

      await stopTimer.mutateAsync({ entryId: entry.id, endTime });
      await refetch();
      setStopTimerEntry(null);
      setOverrideEndTime('');
    } catch (error) {
      console.error('Failed to stop timer:', error);
    }
  };

  const calculateRunningDuration = (startedAt: string) => {
    const start = new Date(startedAt);
    const now = new Date();
    return Math.floor((now.getTime() - start.getTime()) / 1000);
  };

  return (
    <>
      <DashboardSection
        title="Timeclock Issues"
        icon={AlertTriangle}
        className="border-amber-500/30 bg-amber-500/5"
      >
        <div className="space-y-3">
          {/* Completed tasks with no time */}
          {data.completedTasksNoTime.map((task) => (
            <div
              key={task.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-border-warm"
            >
              <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-main truncate">
                  {task.title}
                </div>
                <div className="text-xs text-text-sub">
                  Completed with no time logged
                </div>
                {(task.client || task.project) && (
                  <div className="text-xs text-text-sub mt-0.5">
                    {task.client?.name || task.project?.client?.name}
                    {task.project && ` / ${task.project.name}`}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAddTimeTask(task)}
                  title="Add time"
                >
                  <Plus className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleMarkNoTime(task.id)}
                  title="Mark as no time needed"
                  disabled={markNoTime.isPending}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}

          {/* Running timers */}
          {data.runningTimers.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-surface border border-amber-500/50"
            >
              <Clock className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0 animate-pulse" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-text-main truncate">
                  {entry.task?.title || entry.project?.name || 'Ad-hoc time'}
                </div>
                <div className="text-xs text-amber-600">
                  Running for {formatElapsedTime(calculateRunningDuration(entry.started_at))}
                </div>
                <div className="text-xs text-text-sub mt-0.5">
                  Started {new Date(entry.started_at).toLocaleString()}
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleStopTimer(entry, false)}
                  title="Stop now"
                  disabled={stopTimer.isPending}
                >
                  <Square className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setStopTimerEntry(entry);
                    // Set default end time to now
                    const now = new Date();
                    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
                    setOverrideEndTime(now.toISOString().slice(0, 16));
                  }}
                  title="Stop with custom end time"
                >
                  <Clock className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </DashboardSection>

      {/* Add Time Modal */}
      <Modal open={!!addTimeTask} onOpenChange={() => setAddTimeTask(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add Time</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-text-sub mb-4">
              Add time for: <span className="font-medium text-text-main">{addTimeTask?.title}</span>
            </p>
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                Minutes
              </label>
              <Input
                type="number"
                min="1"
                value={timeMinutes}
                onChange={(e) => setTimeMinutes(e.target.value)}
                placeholder="Enter minutes"
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setAddTimeTask(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddTime}
              disabled={!timeMinutes || createTimeEntry.isPending}
            >
              {createTimeEntry.isPending ? 'Adding...' : 'Add Time'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Stop Timer Modal */}
      <Modal open={!!stopTimerEntry} onOpenChange={() => setStopTimerEntry(null)}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Stop Timer</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <p className="text-sm text-text-sub mb-4">
              Stop timer for: <span className="font-medium text-text-main">
                {stopTimerEntry?.task?.title || stopTimerEntry?.project?.name || 'Ad-hoc time'}
              </span>
            </p>
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                End Time
              </label>
              <Input
                type="datetime-local"
                value={overrideEndTime}
                onChange={(e) => setOverrideEndTime(e.target.value)}
              />
              <p className="text-xs text-text-sub mt-1">
                Started: {stopTimerEntry && new Date(stopTimerEntry.started_at).toLocaleString()}
              </p>
            </div>
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setStopTimerEntry(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => stopTimerEntry && handleStopTimer(stopTimerEntry, true)}
              disabled={!overrideEndTime || stopTimer.isPending}
            >
              {stopTimer.isPending ? 'Stopping...' : 'Stop Timer'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
