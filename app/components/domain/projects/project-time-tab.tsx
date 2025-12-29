'use client';

import * as React from 'react';
import Link from 'next/link';
import { Clock, Calendar, User, Play, RefreshCw } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { useTimeEntries, TimeEntry } from '@/lib/hooks/use-time-entries';
import { formatDuration } from '@/lib/calculations/energy';

interface ProjectTimeTabProps {
  projectId: string;
  budgetHours: number | null;
  budgetLocked: boolean;
}

export function ProjectTimeTab({ projectId, budgetHours, budgetLocked }: ProjectTimeTabProps) {
  // Fetch time entries for this project
  const { data, isLoading, refetch, isFetching } = useTimeEntries({
    project_id: projectId,
    limit: 100,
  });

  const timeEntries = data?.entries || [];

  // Calculate totals
  const totalMinutes = timeEntries.reduce((sum, entry) => sum + entry.duration, 0);
  const budgetMinutes = budgetHours ? budgetHours * 60 : null;
  const percentUsed = budgetMinutes ? Math.round((totalMinutes / budgetMinutes) * 100) : null;

  // Group by user
  const byUser = React.useMemo(() => {
    const userMap = new Map<string, { name: string; totalMinutes: number; entries: TimeEntry[] }>();

    timeEntries.forEach((entry) => {
      const userId = entry.user?.id || 'unknown';
      const userName = entry.user?.name || 'Unknown';

      if (!userMap.has(userId)) {
        userMap.set(userId, { name: userName, totalMinutes: 0, entries: [] });
      }

      const userData = userMap.get(userId)!;
      userData.totalMinutes += entry.duration;
      userData.entries.push(entry);
    });

    return Array.from(userMap.values()).sort((a, b) => b.totalMinutes - a.totalMinutes);
  }, [timeEntries]);

  // Recent entries (last 10)
  const recentEntries = timeEntries.slice(0, 10);

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time Summary */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Time Summary</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-1 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Total Logged */}
            <div className="p-4 bg-surface-2 rounded-lg">
              <div className="flex items-center gap-2 text-text-sub mb-1">
                <Clock className="h-4 w-4" />
                <span className="text-sm">Total Logged</span>
              </div>
              <div className="text-2xl font-semibold text-text-main">
                {formatDuration(totalMinutes)}
              </div>
            </div>

            {/* Budget */}
            {budgetLocked && budgetMinutes && (
              <div className="p-4 bg-surface-2 rounded-lg">
                <div className="flex items-center gap-2 text-text-sub mb-1">
                  <Calendar className="h-4 w-4" />
                  <span className="text-sm">Budget</span>
                </div>
                <div className="text-2xl font-semibold text-text-main">
                  {formatDuration(budgetMinutes)}
                </div>
              </div>
            )}

            {/* Usage */}
            {budgetLocked && percentUsed !== null && (
              <div className="p-4 bg-surface-2 rounded-lg">
                <div className="flex items-center gap-2 text-text-sub mb-1">
                  <Play className="h-4 w-4" />
                  <span className="text-sm">Budget Used</span>
                </div>
                <div className={`text-2xl font-semibold ${percentUsed > 100 ? 'text-red-500' : percentUsed > 80 ? 'text-amber-500' : 'text-text-main'}`}>
                  {percentUsed}%
                </div>
              </div>
            )}
          </div>

          {/* Budget Progress Bar */}
          {budgetLocked && budgetMinutes && (
            <div className="mt-4">
              <div className="flex justify-between text-sm text-text-sub mb-1">
                <span>{formatDuration(totalMinutes)} logged</span>
                <span>{formatDuration(budgetMinutes)} budget</span>
              </div>
              <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    percentUsed && percentUsed > 100 ? 'bg-red-500' : percentUsed && percentUsed > 80 ? 'bg-amber-500' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min(percentUsed || 0, 100)}%` }}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Time by Team Member */}
      {byUser.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Time by Team Member</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {byUser.map((user) => (
                <div key={user.name} className="flex items-center justify-between p-3 bg-surface-2 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-sm font-medium">
                      {user.name.charAt(0)}
                    </div>
                    <div>
                      <div className="font-medium text-text-main">{user.name}</div>
                      <div className="text-xs text-text-sub">{user.entries.length} entries</div>
                    </div>
                  </div>
                  <div className="text-lg font-semibold text-text-main">
                    {formatDuration(user.totalMinutes)}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Recent Time Entries */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent Time Entries</CardTitle>
          <Link href={`/chronicles?project_id=${projectId}`}>
            <Button variant="ghost" size="sm">View All</Button>
          </Link>
        </CardHeader>
        <CardContent>
          {recentEntries.length > 0 ? (
            <div className="space-y-2">
              {recentEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-border"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 text-sm text-text-sub">
                      <User className="h-4 w-4" />
                      {entry.user?.name || 'Unknown'}
                    </div>
                    {entry.description && (
                      <span className="text-sm text-text-main">{entry.description}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-text-sub">
                      {new Date(entry.started_at).toLocaleDateString()}
                    </span>
                    <span className="font-medium text-text-main">
                      {formatDuration(entry.duration)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<Clock className="h-10 w-10" />}
              title="No time entries yet"
              description="Time entries will appear here when team members log their work"
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
