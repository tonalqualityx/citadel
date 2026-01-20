'use client';

import * as React from 'react';
import { Clock } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Avatar } from '@/components/ui/avatar';
import { formatDurationMinutes } from '@/lib/utils/time';

interface TimeEntry {
  id: string;
  duration: number;
  started_at: string;
  description: string | null;
  user: {
    id: string;
    name: string;
  };
}

interface TimeEntriesSectionProps {
  timeEntries: TimeEntry[];
}

export function TimeEntriesSection({ timeEntries }: TimeEntriesSectionProps) {
  const totalMinutes = timeEntries.reduce((sum, entry) => sum + entry.duration, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Clock className="h-4 w-4 text-text-sub" />
          Time Tracked
          {totalMinutes > 0 && (
            <span className="text-sm font-normal text-text-sub ml-auto">
              {formatDurationMinutes(totalMinutes)}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {timeEntries.length === 0 ? (
          <p className="text-sm text-text-sub text-center py-4">
            No time tracked yet
          </p>
        ) : (
          <div className="space-y-3">
            {timeEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 p-2 rounded border border-border"
              >
                <Avatar name={entry.user.name} size="sm" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-text-main">
                    {entry.user.name}
                  </div>
                  <div className="text-sm text-text-sub">
                    {formatDurationMinutes(entry.duration)} &middot;{' '}
                    {new Date(entry.started_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
