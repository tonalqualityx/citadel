'use client';

import { useState, useRef, useEffect } from 'react';
import { Bell, Check, Loader2 } from 'lucide-react';
import {
  useNotifications,
  useUnreadCount,
  useMarkAsRead,
  useMarkAllAsRead,
  useDeleteNotification,
} from '@/lib/hooks/use-notifications';
import { NotificationItem } from './NotificationItem';

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const prevUnreadCountRef = useRef<number | null>(null);

  const { data: notifications, isLoading, refetch: refetchNotifications } = useNotifications();
  const { data: unreadData } = useUnreadCount();
  const markAsRead = useMarkAsRead();
  const markAllAsRead = useMarkAllAsRead();
  const deleteNotification = useDeleteNotification();

  const unreadCount = unreadData?.count ?? 0;

  // Refetch notifications when unread count increases
  useEffect(() => {
    if (prevUnreadCountRef.current !== null && unreadCount > prevUnreadCountRef.current) {
      refetchNotifications();
    }
    prevUnreadCountRef.current = unreadCount;
  }, [unreadCount, refetchNotifications]);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  function handleMarkAsRead(id: string) {
    markAsRead.mutate(id);
  }

  function handleMarkAllAsRead() {
    markAllAsRead.mutate();
  }

  function handleDelete(id: string) {
    deleteNotification.mutate(id);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-text-sub hover:text-text-main rounded-lg hover:bg-background-light transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex items-center justify-center rounded-full h-4 w-4 bg-red-500 text-[10px] font-medium text-white">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          </span>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 rounded-lg bg-surface shadow-lg ring-1 ring-black/5 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border-warm">
            <h3 className="font-semibold text-text-main">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllAsRead}
                disabled={markAllAsRead.isPending}
                className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 disabled:opacity-50 transition-colors"
              >
                {markAllAsRead.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-96 overflow-y-auto">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-text-sub" />
              </div>
            ) : !notifications?.notifications?.length ? (
              <div className="flex flex-col items-center justify-center py-8 text-text-sub">
                <Bell className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-border-warm">
                {notifications.notifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    onMarkAsRead={handleMarkAsRead}
                    onDelete={handleDelete}
                    onClose={() => setIsOpen(false)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          {notifications?.notifications?.length ? (
            <div className="border-t border-border-warm px-4 py-2">
              <a
                href="/notifications"
                className="text-xs text-primary hover:text-primary/80 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                View all notifications
              </a>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
