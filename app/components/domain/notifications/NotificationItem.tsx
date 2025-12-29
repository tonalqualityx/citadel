'use client';

import { formatDistanceToNow } from 'date-fns';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  MessageSquare,
  UserPlus,
  RefreshCw,
  Bell,
  X,
} from 'lucide-react';
import type { Notification } from '@/lib/hooks/use-notifications';

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const typeIcons: Record<string, React.ElementType> = {
  task_assigned: UserPlus,
  task_status_changed: RefreshCw,
  task_mentioned: MessageSquare,
  task_due_soon: Clock,
  task_overdue: AlertCircle,
  project_status_changed: RefreshCw,
  review_requested: CheckCircle2,
  comment_added: MessageSquare,
  retainer_alert: AlertCircle,
  system_alert: Bell,
};

const typeColors: Record<string, string> = {
  task_assigned: 'text-blue-500',
  task_status_changed: 'text-green-500',
  task_mentioned: 'text-purple-500',
  task_due_soon: 'text-amber-500',
  task_overdue: 'text-red-500',
  project_status_changed: 'text-green-500',
  review_requested: 'text-teal-500',
  comment_added: 'text-purple-500',
  retainer_alert: 'text-amber-500',
  system_alert: 'text-gray-500',
};

export function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
  onClose,
}: NotificationItemProps) {
  const router = useRouter();
  const Icon = typeIcons[notification.type] || Bell;
  const iconColor = typeColors[notification.type] || 'text-gray-500';

  function handleClick() {
    if (!notification.is_read) {
      onMarkAsRead(notification.id);
    }

    // Navigate to the entity if available
    if (notification.entity_type && notification.entity_id) {
      const routes: Record<string, string> = {
        task: `/tasks/${notification.entity_id}`,
        project: `/projects/${notification.entity_id}`,
        sop: `/grimoire/runes/${notification.entity_id}`,
        recipe: `/grimoire/rituals/${notification.entity_id}`,
      };
      const route = routes[notification.entity_type];
      if (route) {
        router.push(route);
        onClose();
      }
    }
  }

  return (
    <div
      className={`group flex items-start gap-3 p-3 hover:bg-background-light cursor-pointer transition-colors ${
        !notification.is_read ? 'bg-primary/5' : ''
      }`}
      onClick={handleClick}
    >
      <div className={`mt-0.5 ${iconColor}`}>
        <Icon className="h-5 w-5" />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={`text-sm ${
              notification.is_read ? 'text-text-sub' : 'text-text-main font-medium'
            }`}
          >
            {notification.title}
            {notification.bundle_count > 1 && (
              <span className="ml-1 text-xs text-text-sub">
                (+{notification.bundle_count - 1} more)
              </span>
            )}
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(notification.id);
            }}
            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-surface-alt text-text-sub hover:text-text-main transition-all"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {notification.message && (
          <p className="text-xs text-text-sub mt-0.5 line-clamp-2">
            {notification.message}
          </p>
        )}

        <p className="text-xs text-text-sub/70 mt-1">
          {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true })}
        </p>
      </div>

      {!notification.is_read && (
        <div className="w-2 h-2 rounded-full bg-primary mt-2 shrink-0" />
      )}
    </div>
  );
}
