'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, ArrowRight } from 'lucide-react';
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

export function RetainerAlert({ alerts }: RetainerAlertProps) {
  if (alerts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <Link key={alert.client_id} href={`/clients/${alert.client_id}`}>
          <div
            className={`flex items-center justify-between p-3 rounded-lg border ${
              alert.percent_used >= 100
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-amber-500/10 border-amber-500/30'
            }`}
          >
            <div className="flex items-center gap-3">
              <AlertTriangle
                className={`h-5 w-5 ${
                  alert.percent_used >= 100 ? 'text-red-500' : 'text-amber-500'
                }`}
              />
              <div>
                <div className="font-medium text-text-main">{alert.client_name}</div>
                <div className="text-xs text-text-sub">
                  {formatDuration(alert.used_minutes)} of{' '}
                  {formatDuration(alert.retainer_hours * 60)} used
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`text-lg font-semibold ${
                  alert.percent_used >= 100 ? 'text-red-500' : 'text-amber-500'
                }`}
              >
                {alert.percent_used}%
              </span>
              <ArrowRight className="h-4 w-4 text-text-sub" />
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
