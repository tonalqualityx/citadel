'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';
import { designKeys } from '@/lib/hooks/use-design';

// Designer Portal admin hooks (design 7.2). Reads: admin and pm. Writes: admin only (the server enforces it).

export type PublishMode = 'per_site' | 'pre_launch_only' | 'off';

export interface AdminSettings {
  enabled: boolean;
  owner_user_id: string | null;
  designer_publish_mode: PublishMode;
  confirmation_ttl_minutes: number;
  default_session_budget_usd: number;
  designer_raise_cap_usd: number;
  hard_session_cap_usd: number;
  default_monthly_cap_usd: number | null;
  model: string;
  effort: string;
  idle_close_minutes: number;
  auto_timer_enabled: boolean;
  auto_timer_lapse_minutes: number;
  auto_timer_billable: boolean;
  max_live_sessions: number;
  updated_at: string | null;
}

export interface AdminSession {
  id: string;
  task: { id: string; title: string };
  site: { name: string };
  designer: { name: string };
  status: string;
  cost_usd: number;
  budget_usd: number;
  updated_at: string;
  last_publish: { id: string; status: string; finished_at: string | null } | null;
  publish_requested_at: string | null;
  timer: { running: boolean; elapsed_s: number };
}

export interface AdminPublish {
  id: string;
  kind: string;
  status: string;
  site: { name: string };
  actor: { name: string; role: string };
  main_role: 'client_preview' | 'production';
  created_at: string;
  finished_at: string | null;
  deploy_url: string | null;
}

export interface AdminBudget {
  user: { id: string; name: string };
  monthly_cap_usd: number | null;
  session_raise_cap_usd: number | null;
  effective_session_raise_cap_usd: number;
  month_spend_usd: number;
}

export interface AdminSite {
  id: string;
  name: string;
  url: string | null;
  design_portal_enabled: boolean;
  designer_publish: boolean;
  design_auto_timer: boolean;
  effective_designer_publish: boolean;
  main_role: 'client_preview' | 'production';
}

export type SiteToggleField = 'design_portal_enabled' | 'designer_publish' | 'design_auto_timer';

const adminKeys = {
  all: [...designKeys.all, 'admin'] as const,
  settings: () => [...adminKeys.all, 'settings'] as const,
  sessions: () => [...adminKeys.all, 'sessions'] as const,
  publishes: () => [...adminKeys.all, 'publishes'] as const,
  budgets: () => [...adminKeys.all, 'budgets'] as const,
  sites: () => [...adminKeys.all, 'sites'] as const,
};
export { adminKeys as designAdminKeys };

export function useAdminSettings(enabled = true) {
  return useQuery({ queryKey: adminKeys.settings(), enabled, queryFn: () => apiClient.get<{ settings: AdminSettings }>('/design/admin/settings') });
}

export function useUpdateAdminSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AdminSettings>) => apiClient.patch<{ settings: AdminSettings }>('/design/admin/settings', patch),
    onSuccess: () => {
      showToast.success('Settings saved');
      queryClient.invalidateQueries({ queryKey: adminKeys.settings() });
    },
    onError: (e) => showToast.apiError(e, 'Could not save the settings'),
  });
}

export function useAdminSessions() {
  return useQuery({
    queryKey: adminKeys.sessions(),
    queryFn: () => apiClient.get<{ sessions: AdminSession[] }>('/design/admin/sessions'),
    refetchInterval: 30_000,
  });
}

export function useAdminPublishes() {
  return useQuery({
    queryKey: adminKeys.publishes(),
    queryFn: () => apiClient.get<{ publishes: AdminPublish[] }>('/design/admin/publishes'),
    refetchInterval: 30_000,
  });
}

export function useAdminBudgets(enabled = true) {
  return useQuery({ queryKey: adminKeys.budgets(), enabled, queryFn: () => apiClient.get<{ budgets: AdminBudget[] }>('/design/admin/budgets') });
}

export function useUpdateBudget() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; monthly_cap_usd?: number | null; session_raise_cap_usd?: number | null }) => {
      const { userId, ...body } = v;
      return apiClient.put(`/design/admin/budgets/${userId}`, body);
    },
    onSuccess: () => {
      showToast.success('Budget saved');
      queryClient.invalidateQueries({ queryKey: adminKeys.budgets() });
    },
    onError: (e) => showToast.apiError(e, 'Could not save the budget'),
  });
}

export function useAdminSites() {
  return useQuery({ queryKey: adminKeys.sites(), queryFn: () => apiClient.get<{ sites: AdminSite[] }>('/design/admin/sites') });
}

export function useUpdateSiteToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { siteId: string; field: SiteToggleField; value: boolean }) =>
      apiClient.patch(`/design/admin/sites/${v.siteId}`, { [v.field]: v.value }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: adminKeys.sites() }),
    onError: (e) => showToast.apiError(e, 'Could not change the site'),
  });
}
