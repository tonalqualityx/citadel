'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { appSettingsKeys } from '@/lib/api/query-keys';

export interface BugReportSettings {
  bug_report_project_id: string | null;
  bug_report_phase_id: string | null;
  bug_report_notify_user_id: string | null;
  bug_report_project: { id: string; name: string } | null;
  bug_report_phase: { id: string; name: string } | null;
  bug_report_notify_user: { id: string; name: string; email: string } | null;
}

export interface UpdateBugReportSettingsInput {
  bug_report_project_id?: string | null;
  bug_report_phase_id?: string | null;
  bug_report_notify_user_id?: string | null;
}

export function useBugReportSettings() {
  return useQuery({
    queryKey: appSettingsKeys.bugReport(),
    queryFn: async (): Promise<BugReportSettings> => {
      return apiClient.get<BugReportSettings>('/settings/bug-report');
    },
  });
}

export function useUpdateBugReportSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateBugReportSettingsInput): Promise<BugReportSettings> => {
      return apiClient.patch<BugReportSettings>('/settings/bug-report', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: appSettingsKeys.all });
    },
  });
}

// Helper to check if bug reporting is configured
export function isBugReportConfigured(settings: BugReportSettings | undefined): boolean {
  if (!settings) return false;
  return !!(settings.bug_report_project_id && settings.bug_report_phase_id);
}
