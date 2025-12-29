'use client';

import * as React from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  Clock,
  ArrowRight,
  User,
  CircleDot,
  CheckCircle2,
} from 'lucide-react';
import { DashboardTask } from '@/lib/hooks/use-dashboard';
import { getPriorityLabel, getPriorityColor } from '@/lib/utils/priority';

interface TaskQuickListProps {
  tasks: DashboardTask[];
  emptyMessage?: string;
  showProject?: boolean;
  showAssignee?: boolean;
  showDueDate?: boolean;
  maxItems?: number;
  onTaskClick?: (taskId: string) => void;
}

export function TaskQuickList({
  tasks,
  emptyMessage = 'No tasks',
  showProject = true,
  showAssignee = false,
  showDueDate = false,
  maxItems = 10,
  onTaskClick,
}: TaskQuickListProps) {
  const displayTasks = tasks.slice(0, maxItems);

  if (displayTasks.length === 0) {
    return (
      <div className="text-center py-6 text-text-sub">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'blocked':
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case 'in_progress':
        return <Clock className="h-4 w-4 text-blue-500" />;
      case 'review':
        return <CircleDot className="h-4 w-4 text-purple-500" />;
      case 'done':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      default:
        return <CircleDot className="h-4 w-4 text-text-sub" />;
    }
  };

  const formatDueDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays < 0) {
      return { text: `${Math.abs(diffDays)}d overdue`, isOverdue: true };
    }
    if (diffDays === 0) {
      return { text: 'Due today', isOverdue: false };
    }
    if (diffDays === 1) {
      return { text: 'Due tomorrow', isOverdue: false };
    }
    if (diffDays <= 7) {
      return { text: `Due in ${diffDays}d`, isOverdue: false };
    }
    return { text: date.toLocaleDateString(), isOverdue: false };
  };

  return (
    <div className="space-y-1">
      {displayTasks.map((task) => {
        const dueInfo = showDueDate ? formatDueDate(task.due_date) : null;

        const content = (
          <div
            className={`group flex items-center justify-between p-2 rounded-lg hover:bg-surface-2 transition-colors ${
              onTaskClick ? 'cursor-pointer' : ''
            }`}
            onClick={() => onTaskClick?.(task.id)}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1">
              {getStatusIcon(task.status)}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-main truncate">
                    {task.title}
                  </span>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded ${getPriorityColor(task.priority)}`}
                  >
                    {getPriorityLabel(task.priority)}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-sub">
                  {showProject && task.project && (
                    <span>{task.project.name}</span>
                  )}
                  {showAssignee && task.assignee && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      {task.assignee.name}
                    </span>
                  )}
                  {dueInfo && (
                    <span className={dueInfo.isOverdue ? 'text-red-500' : ''}>
                      {dueInfo.text}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-sub opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        );

        return onTaskClick ? (
          <div key={task.id}>{content}</div>
        ) : (
          <Link key={task.id} href={`/tasks/${task.id}`}>
            {content}
          </Link>
        );
      })}
    </div>
  );
}
