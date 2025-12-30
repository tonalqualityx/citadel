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
