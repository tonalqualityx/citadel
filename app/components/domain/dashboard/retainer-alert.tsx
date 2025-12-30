'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, X } from 'lucide-react';
import { formatDuration } from '@/lib/calculations/energy';

interface RetainerAlertProps {
  alerts: {
    client_id: string;
    client_name: string;
    retainer_hours: number;
    used_minutes: number;
    percent_used: number;
  }[];
}

// Get storage key for current month (alerts reset each month)
function getDismissedKey(): string {
  const now = new Date();
  return `retainer-alerts-dismissed-${now.getFullYear()}-${now.getMonth() + 1}`;
}

function getDismissedAlerts(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const stored = localStorage.getItem(getDismissedKey());
    return stored ? new Set(JSON.parse(stored)) : new Set();
  } catch {
    return new Set();
  }
}

function saveDismissedAlerts(dismissed: Set<string>): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(getDismissedKey(), JSON.stringify([...dismissed]));
}

export function RetainerAlert({ alerts }: RetainerAlertProps) {
  const [dismissed, setDismissed] = React.useState<Set<string>>(new Set());

  // Load dismissed alerts on mount
  React.useEffect(() => {
    setDismissed(getDismissedAlerts());
  }, []);

  const handleDismiss = (e: React.MouseEvent, clientId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const newDismissed = new Set(dismissed);
    newDismissed.add(clientId);
    setDismissed(newDismissed);
    saveDismissedAlerts(newDismissed);
  };

  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.client_id));

  if (visibleAlerts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {visibleAlerts.map((alert) => (
        <div
          key={alert.client_id}
          className={`flex items-center justify-between p-3 rounded-lg border ${
            alert.percent_used >= 100
              ? 'bg-red-500/10 border-red-500/30'
              : 'bg-amber-500/10 border-amber-500/30'
          }`}
        >
          <Link href={`/clients/${alert.client_id}`} className="flex items-center gap-3 flex-1 min-w-0">
            <AlertTriangle
              className={`h-5 w-5 shrink-0 ${
                alert.percent_used >= 100 ? 'text-red-500' : 'text-amber-500'
              }`}
            />
            <div className="min-w-0">
              <div className="font-medium text-text-main truncate">{alert.client_name}</div>
              <div className="text-xs text-text-sub">
                {formatDuration(alert.used_minutes)} of{' '}
                {formatDuration(alert.retainer_hours * 60)} used
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            <span
              className={`text-lg font-semibold ${
                alert.percent_used >= 100 ? 'text-red-500' : 'text-amber-500'
              }`}
            >
              {alert.percent_used}%
            </span>
            <button
              onClick={(e) => handleDismiss(e, alert.client_id)}
              className="p-1 rounded hover:bg-black/10 text-text-sub hover:text-text-main transition-colors"
              title="Dismiss until next month"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
