'use client';

import * as React from 'react';
import { Bell, Mail, MessageSquare, Lock, Loader2 } from 'lucide-react';
import { NotificationType } from '@prisma/client';
import {
  useNotificationPreferences,
  useToggleNotificationPreference,
  NOTIFICATION_TYPE_LABELS,
  NOTIFICATION_TYPE_DESCRIPTIONS,
  NotificationChannel,
} from '@/lib/hooks/use-notification-preferences';

// Order notification types for display
const NOTIFICATION_TYPE_ORDER: NotificationType[] = [
  'task_assigned',
  'task_status_changed',
  'task_mentioned',
  'task_due_soon',
  'task_overdue',
  'comment_added',
  'review_requested',
  'project_status_changed',
  'retainer_alert',
  'system_alert',
];

interface NotificationPreferencesProps {
  className?: string;
}

export function NotificationPreferences({ className }: NotificationPreferencesProps) {
  const { data, isLoading, error } = useNotificationPreferences();
  const togglePreference = useToggleNotificationPreference();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-12 text-text-sub">
        Failed to load notification preferences
      </div>
    );
  }

  const { preferences, slackConnected } = data;

  // Create a map for quick lookup
  const prefsMap = new Map(
    preferences.map((p) => [p.notification_type, p])
  );

  const handleToggle = (
    type: NotificationType,
    channel: NotificationChannel,
    currentValue: boolean,
    isLocked: boolean
  ) => {
    if (isLocked) return;

    togglePreference.mutate({
      notification_type: type,
      channel,
      enabled: !currentValue,
    });
  };

  return (
    <div className={className}>
      {/* Table-style layout for matrix */}
      <table className="w-full">
        <thead>
          <tr className="border-b border-border-warm">
            <th className="text-left text-sm font-medium text-text-sub p-4">
              Notification Type
            </th>
            <th className="text-center text-sm font-medium text-text-sub p-4 w-20">
              <div className="flex items-center justify-center gap-1">
                <Bell className="h-4 w-4" />
                <span className="hidden sm:inline">In-App</span>
              </div>
            </th>
            <th className="text-center text-sm font-medium text-text-sub p-4 w-20">
              <div className="flex items-center justify-center gap-1">
                <Mail className="h-4 w-4" />
                <span className="hidden sm:inline">Email</span>
              </div>
            </th>
            <th className="text-center text-sm font-medium text-text-sub p-4 w-20">
              <div className="flex items-center justify-center gap-1">
                <MessageSquare className="h-4 w-4" />
                <span className="hidden sm:inline">Slack</span>
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {NOTIFICATION_TYPE_ORDER.map((type) => {
            const pref = prefsMap.get(type);
            if (!pref) return null;

            return (
              <PreferenceRow
                key={type}
                type={type}
                label={NOTIFICATION_TYPE_LABELS[type]}
                description={NOTIFICATION_TYPE_DESCRIPTIONS[type]}
                inApp={pref.in_app}
                email={pref.email}
                slack={pref.slack}
                isLocked={pref.admin_override}
                slackConnected={slackConnected}
                onToggle={(channel, current) =>
                  handleToggle(type, channel, current, pref.admin_override)
                }
                isPending={togglePreference.isPending}
              />
            );
          })}
        </tbody>
      </table>

      {/* Footer note */}
      <div className="mt-6 p-4 bg-surface-alt rounded-lg">
        <p className="text-sm text-text-sub">
          <strong>Priority routing:</strong> Critical and high-priority notifications are sent
          immediately. Normal-priority email notifications are batched into a daily digest at 8 AM.
        </p>
        {!slackConnected && (
          <p className="text-sm text-text-sub mt-2">
            <MessageSquare className="h-4 w-4 inline mr-1" />
            Slack notifications require your account to be linked by an administrator.
          </p>
        )}
      </div>
    </div>
  );
}

interface PreferenceRowProps {
  type: NotificationType;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
  slack: boolean;
  isLocked: boolean;
  slackConnected: boolean;
  onToggle: (channel: NotificationChannel, currentValue: boolean) => void;
  isPending: boolean;
}

function PreferenceRow({
  type,
  label,
  description,
  inApp,
  email,
  slack,
  isLocked,
  slackConnected,
  onToggle,
  isPending,
}: PreferenceRowProps) {
  return (
    <tr className="border-b border-border-warm last:border-b-0 hover:bg-surface-alt/50 transition-colors">
      {/* Label */}
      <td className="p-4">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-main">{label}</span>
          {isLocked && (
            <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded">
              <Lock className="h-3 w-3" />
              Admin
            </span>
          )}
        </div>
        <p className="text-sm text-text-sub mt-0.5">{description}</p>
      </td>

      {/* In-App Toggle */}
      <td className="p-4 text-center">
        <ToggleSwitch
          checked={inApp}
          onChange={() => onToggle('in_app', inApp)}
          disabled={isLocked || isPending}
        />
      </td>

      {/* Email Toggle */}
      <td className="p-4 text-center">
        <ToggleSwitch
          checked={email}
          onChange={() => onToggle('email', email)}
          disabled={isLocked || isPending}
        />
      </td>

      {/* Slack Toggle */}
      <td className="p-4 text-center">
        <ToggleSwitch
          checked={slack}
          onChange={() => onToggle('slack', slack)}
          disabled={isLocked || isPending || !slackConnected}
          title={!slackConnected ? 'Slack not connected' : undefined}
        />
      </td>
    </tr>
  );
}

interface ToggleSwitchProps {
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  title?: string;
}

function ToggleSwitch({ checked, onChange, disabled, title }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      title={title}
      className={`
        relative w-10 h-6 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-primary/50
        ${checked ? 'bg-primary' : 'bg-background-light'}
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
      `}
    >
      <span
        className={`
          absolute top-1 left-1 w-4 h-4 bg-surface rounded-full shadow transition-transform
          ${checked ? 'translate-x-4' : 'translate-x-0'}
        `}
      />
    </button>
  );
}
