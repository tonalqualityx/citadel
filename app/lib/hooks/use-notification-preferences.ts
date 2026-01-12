import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { NotificationType } from '@prisma/client';

export type NotificationChannel = 'in_app' | 'email' | 'slack';

export interface NotificationPreferenceRow {
  notification_type: NotificationType;
  in_app: boolean;
  email: boolean;
  slack: boolean;
  admin_override: boolean;
  overridden_by_id: string | null;
  overridden_at: string | null;
}

export interface PreferenceMatrix {
  preferences: NotificationPreferenceRow[];
  slackConnected: boolean;
}

interface UpdatePreference {
  notification_type: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
}

/**
 * Hook to get and update the current user's notification preferences
 */
export function useNotificationPreferences() {
  return useQuery<PreferenceMatrix>({
    queryKey: ['notification-preferences'],
    queryFn: async (): Promise<PreferenceMatrix> => {
      return apiClient.get<PreferenceMatrix>('/users/me/notification-preferences');
    },
  });
}

/**
 * Hook to update notification preferences
 */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (updates: UpdatePreference[]) => {
      return apiClient.patch('/users/me/notification-preferences', { updates });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}

/**
 * Hook to toggle a single preference
 */
export function useToggleNotificationPreference() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (update: UpdatePreference) => {
      return apiClient.patch('/users/me/notification-preferences', {
        updates: [update],
      });
    },
    // Optimistic update
    onMutate: async (update) => {
      await queryClient.cancelQueries({ queryKey: ['notification-preferences'] });

      const previous = queryClient.getQueryData<PreferenceMatrix>([
        'notification-preferences',
      ]);

      if (previous) {
        queryClient.setQueryData<PreferenceMatrix>(
          ['notification-preferences'],
          {
            ...previous,
            preferences: previous.preferences.map((pref) =>
              pref.notification_type === update.notification_type
                ? { ...pref, [update.channel]: update.enabled }
                : pref
            ),
          }
        );
      }

      return { previous };
    },
    onError: (err, update, context) => {
      if (context?.previous) {
        queryClient.setQueryData(['notification-preferences'], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });
}

// Notification type labels for display
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  task_assigned: 'Task Assigned',
  task_status_changed: 'Task Status Changed',
  task_mentioned: 'You Were Mentioned',
  task_due_soon: 'Task Due Soon',
  task_overdue: 'Task Overdue',
  project_status_changed: 'Project Status Changed',
  review_requested: 'Review Requested',
  comment_added: 'New Comment',
  retainer_alert: 'Retainer Alert',
  system_alert: 'System Alert',
};

// Notification type descriptions
export const NOTIFICATION_TYPE_DESCRIPTIONS: Record<NotificationType, string> = {
  task_assigned: 'When a task is assigned to you',
  task_status_changed: 'When a task you\'re involved in changes status',
  task_mentioned: 'When someone mentions you in a task or comment',
  task_due_soon: 'When a task is due within 24 hours',
  task_overdue: 'When a task is past its due date',
  project_status_changed: 'When a project status changes',
  review_requested: 'When someone requests your review',
  comment_added: 'When someone comments on a task you\'re involved in',
  retainer_alert: 'When a client\'s retainer hours are running low',
  system_alert: 'Important system notifications',
};
