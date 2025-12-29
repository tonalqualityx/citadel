'use client';

import Link from 'next/link';
import { useTimer } from '@/lib/contexts/timer-context';
import { formatElapsedTime } from '@/lib/utils/time';
import { Play, Square, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function TimerWidget() {
  const { isRunning, taskId, taskTitle, projectName, elapsedSeconds, stopTimer, cancelTimer, isLoading } = useTimer();

  if (!isRunning) {
    return (
      <div className="hidden lg:flex items-center text-sm text-text-sub gap-1">
        <Play className="h-4 w-4" />
        <span>No timer</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-md">
      {/* Pulsing indicator */}
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
        </span>
        <span className="text-sm font-mono text-amber-700 tabular-nums">
          {formatElapsedTime(elapsedSeconds)}
        </span>
      </div>

      {/* Task info */}
      <div className="hidden lg:block">
        <Link
          href={taskId ? `/tasks/${taskId}` : '#'}
          className="text-sm text-amber-800 hover:underline max-w-[200px] truncate block"
        >
          {taskTitle}
        </Link>
        {projectName && (
          <span className="text-xs text-amber-600 truncate block max-w-[200px]">
            {projectName}
          </span>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={stopTimer}
          disabled={isLoading}
          className="h-7 w-7 p-0 text-amber-600 hover:text-amber-800 hover:bg-amber-100"
          title="Stop timer"
        >
          <Square className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={cancelTimer}
          disabled={isLoading}
          className="h-7 w-7 p-0 text-stone-400 hover:text-stone-600 hover:bg-stone-100"
          title="Cancel timer (discard time)"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
