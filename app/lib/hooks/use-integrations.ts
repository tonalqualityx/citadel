'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { integrationKeys } from '@/lib/api/query-keys';
import { toast } from 'sonner';

export interface IntegrationConfig {
  apiKey?: string;
  fromEmail?: string;
  [key: string]: unknown;
}

export interface Integration {
  id?: string;
  provider: string;
  config: IntegrationConfig;
  is_active: boolean;
  updated_at?: string;
  updated_by?: string;
}

export interface IntegrationListResponse {
  integrations: Integration[];
}

export interface SendGridTestResponse {
  success: boolean;
  message: string;
}

// Get all integrations
export function useIntegrations() {
  return useQuery({
    queryKey: integrationKeys.lists(),
    queryFn: async (): Promise<IntegrationListResponse> => {
      return apiClient.get<IntegrationListResponse>('/admin/integrations');
    },
  });
}

// Get a specific integration by provider
export function useIntegration(provider: string) {
  return useQuery({
    queryKey: integrationKeys.provider(provider),
    queryFn: async (): Promise<Integration> => {
      return apiClient.get<Integration>(`/admin/integrations/${provider}`);
    },
    enabled: !!provider,
  });
}

// Update an integration
export function useUpdateIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      provider,
      config,
    }: {
      provider: string;
      config: IntegrationConfig;
    }): Promise<Integration> => {
      return apiClient.put<Integration>(`/admin/integrations/${provider}`, { config });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: integrationKeys.all });
      toast.success('Integration settings saved');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save integration settings');
    },
  });
}

// Test SendGrid connection
export function useTestSendGrid() {
  return useMutation({
    mutationFn: async (config: {
      apiKey?: string;
      fromEmail: string;
      toEmail: string;
    }): Promise<SendGridTestResponse> => {
      return apiClient.post<SendGridTestResponse>('/admin/integrations/sendgrid/test', config);
    },
    onSuccess: (data) => {
      toast.success(data.message);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to send test email');
    },
  });
}

// Slack specific types
export interface SlackTestResponse {
  success: boolean;
  teamName?: string;
  teamId?: string;
  botName?: string;
  botId?: string;
  error?: string;
}

export interface SlackUser {
  id: string;
  name: string;
  real_name?: string;
  email?: string;
}

export interface SlackMapping {
  userId: string;
  userName: string;
  userEmail: string;
  slackUserId: string | null;
  slackTeamId: string | null;
  slackDisplayName: string | null;
  isLinked: boolean;
}

// Test Slack connection
export function useTestSlack() {
  return useMutation({
    mutationFn: async (config?: {
      botToken?: string;
    }): Promise<SlackTestResponse> => {
      return apiClient.post<SlackTestResponse>('/admin/integrations/slack/test', config || {});
    },
    onSuccess: (data) => {
      if (data.success) {
        toast.success(`Connected to ${data.teamName} as ${data.botName}`);
      }
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to connect to Slack');
    },
  });
}

// Get Slack workspace users
export function useSlackUsers() {
  return useQuery({
    queryKey: ['slack', 'users'],
    queryFn: async (): Promise<{ users: SlackUser[] }> => {
      return apiClient.get<{ users: SlackUser[] }>('/admin/slack/users');
    },
  });
}

// Get Slack user mappings
export function useSlackMappings() {
  return useQuery({
    queryKey: ['slack', 'mappings'],
    queryFn: async (): Promise<{ mappings: SlackMapping[] }> => {
      return apiClient.get<{ mappings: SlackMapping[] }>('/admin/slack/mappings');
    },
  });
}

// Create/update Slack mapping
export function useCreateSlackMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: {
      userId: string;
      slackUserId: string;
      displayName?: string;
    }) => {
      return apiClient.post('/admin/slack/mappings', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack', 'mappings'] });
      toast.success('Slack mapping saved');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to save mapping');
    },
  });
}

// Delete Slack mapping
export function useDeleteSlackMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userId: string) => {
      return apiClient.delete(`/admin/slack/mappings/${userId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slack', 'mappings'] });
      toast.success('Slack mapping removed');
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Failed to remove mapping');
    },
  });
}

// Auto-match Slack users by email
export function useAutoMatchSlackUsers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (userIds?: string[]) => {
      return apiClient.post<{
        matchedCount: number;
        totalAttempted: number;
        results: Array<{
          userId: string;
          userName: string;
          matched: boolean;
          slackUserId?: string;
          error?: string;
        }>;
      }>('/admin/slack/mappings', { autoMatch: true, userIds });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['slack', 'mappings'] });
      toast.success(`Matched ${data.matchedCount} of ${data.totalAttempted} users`);
    },
    onError: (error: Error) => {
      toast.error(error.message || 'Auto-match failed');
    },
  });
}
