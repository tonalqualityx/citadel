'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { meetingKeys, accordKeys, taskKeys } from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  MeetingWithRelations,
  MeetingListResponse,
  CreateMeetingInput,
  UpdateMeetingInput,
} from '@/types/entities';

interface MeetingFilters {
  search?: string;
  client_id?: string;
  accord_id?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

export function useMeetings(filters: MeetingFilters = {}) {
  return useQuery({
    queryKey: meetingKeys.list(filters),
    queryFn: async (): Promise<MeetingListResponse> => {
      const params = new URLSearchParams();
      if (filters.search) params.set('search', filters.search);
      if (filters.client_id) params.set('client_id', filters.client_id);
      if (filters.accord_id) params.set('accord_id', filters.accord_id);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (filters.page) params.set('page', String(filters.page));
      if (filters.limit) params.set('limit', String(filters.limit));
      const query = params.toString();
      return apiClient.get<MeetingListResponse>(`/meetings${query ? `?${query}` : ''}`);
    },
  });
}

export function useMeeting(id: string | null) {
  return useQuery({
    queryKey: meetingKeys.detail(id!),
    queryFn: async (): Promise<MeetingWithRelations> => {
      return apiClient.get<MeetingWithRelations>(`/meetings/${id}`);
    },
    enabled: !!id,
  });
}

export function useCreateMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateMeetingInput): Promise<MeetingWithRelations> => {
      return apiClient.post<MeetingWithRelations>('/meetings', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.lists() });
      showToast.created('Meeting');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create meeting');
    },
  });
}

export function useUpdateMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateMeetingInput;
    }): Promise<MeetingWithRelations> => {
      return apiClient.patch<MeetingWithRelations>(`/meetings/${id}`, data);
    },
    onSuccess: (_, { id }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(id) });
      queryClient.invalidateQueries({ queryKey: meetingKeys.lists() });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update meeting');
    },
  });
}

export function useDeleteMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      await apiClient.delete(`/meetings/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.lists() });
      showToast.deleted('Meeting');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete meeting');
    },
  });
}

export function useAddMeetingAttendee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      user_id,
    }: {
      meetingId: string;
      user_id: string;
    }): Promise<{ id: string; meeting_id: string; user_id: string }> => {
      return apiClient.post(`/meetings/${meetingId}/attendees`, { user_id });
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add attendee');
    },
  });
}

export function useRemoveMeetingAttendee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      attendeeId,
    }: {
      meetingId: string;
      attendeeId: string;
    }): Promise<void> => {
      await apiClient.delete(`/meetings/${meetingId}/attendees/${attendeeId}`);
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to remove attendee');
    },
  });
}

export function useLinkMeetingAccord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      accord_id,
    }: {
      meetingId: string;
      accord_id: string;
    }): Promise<{ id: string; meeting_id: string; accord_id: string }> => {
      return apiClient.post(`/meetings/${meetingId}/accords`, { accord_id });
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
      queryClient.invalidateQueries({ queryKey: accordKeys.all });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to link accord');
    },
  });
}

export function useUnlinkMeetingAccord() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      accordId,
    }: {
      meetingId: string;
      accordId: string;
    }): Promise<void> => {
      await apiClient.delete(`/meetings/${meetingId}/accords/${accordId}`);
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to unlink accord');
    },
  });
}

export function useLinkMeetingProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      project_id,
    }: {
      meetingId: string;
      project_id: string;
    }): Promise<{ id: string; meeting_id: string; project_id: string }> => {
      return apiClient.post(`/meetings/${meetingId}/projects`, { project_id });
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to link project');
    },
  });
}

export function useUnlinkMeetingProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      projectId,
    }: {
      meetingId: string;
      projectId: string;
    }): Promise<void> => {
      await apiClient.delete(`/meetings/${meetingId}/projects/${projectId}`);
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to unlink project');
    },
  });
}

export function useLinkMeetingCharter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      charter_id,
    }: {
      meetingId: string;
      charter_id: string;
    }): Promise<{ id: string; meeting_id: string; charter_id: string }> => {
      return apiClient.post(`/meetings/${meetingId}/charters`, { charter_id });
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to link charter');
    },
  });
}

export function useUnlinkMeetingCharter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      charterId,
    }: {
      meetingId: string;
      charterId: string;
    }): Promise<void> => {
      await apiClient.delete(`/meetings/${meetingId}/charters/${charterId}`);
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to unlink charter');
    },
  });
}

export function useIncompleteMeetings() {
  return useQuery({
    queryKey: meetingKeys.incomplete(),
    queryFn: async () => {
      return apiClient.get('/meetings/incomplete');
    },
  });
}

export function useCreateTaskFromMeeting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      meetingId,
      data,
    }: {
      meetingId: string;
      data: Record<string, unknown>;
    }) => {
      return apiClient.post(`/meetings/${meetingId}/tasks`, data);
    },
    onSuccess: (_, { meetingId }) => {
      queryClient.invalidateQueries({ queryKey: meetingKeys.detail(meetingId) });
      queryClient.invalidateQueries({ queryKey: taskKeys.lists() });
      showToast.created('Task');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create task from meeting');
    },
  });
}
