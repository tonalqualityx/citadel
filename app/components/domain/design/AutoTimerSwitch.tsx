'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { Switch } from '@/components/ui/switch';

interface AutoTimerSetting {
  auto_time_tracking: boolean;
}

export const AUTO_TIMER_KEY = ['design', 'me', 'auto-timer'] as const;

/**
 * The person's own automatic time tracking switch in the portal header (Mike, 2026-11-26). On: opening a task's page
 * starts their timer. Off (the default for everyone but Mike): timers start only when they start them.
 */
export function AutoTimerSwitch() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: AUTO_TIMER_KEY,
    queryFn: () => apiClient.get<AutoTimerSetting>('/design/me/auto-timer'),
    staleTime: Infinity,
  });
  const update = useMutation({
    mutationFn: (on: boolean) => apiClient.patch<AutoTimerSetting>('/design/me/auto-timer', { auto_time_tracking: on }),
    onSuccess: (next) => queryClient.setQueryData(AUTO_TIMER_KEY, next),
  });
  if (isLoading || !data) return null;
  const on = data.auto_time_tracking;
  return (
    <label
      htmlFor="design-auto-timer"
      className="flex items-center gap-2 text-text-sub"
      title="When on, your timer starts as soon as you open a task. When off, timers start only when you start them."
    >
      <span>Auto timer</span>
      <Switch id="design-auto-timer" checked={on} onCheckedChange={(next) => update.mutate(next)} disabled={update.isPending} />
    </label>
  );
}
