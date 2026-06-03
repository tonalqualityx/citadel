'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import {
  troubadorRunKeys,
  troubadorScheduleKeys,
  troubadorArticleKeys,
  troubadorCalendarKeys,
  type TroubadorRunFilters,
  type TroubadorScheduleFilters,
} from '@/lib/api/query-keys';
import { showToast } from '@/lib/hooks/use-toast';
import type {
  RunDetail,
  RunListResponse,
  CreateRunInput,
  UpdateRunInput,
  UpdateProposalsInput,
  Article,
  UpdateArticleInput,
  Schedule,
  ScheduleListResponse,
  CreateScheduleInput,
  UpdateScheduleInput,
  CalendarResponse,
} from '@/lib/types/troubador';

// ============================================
// RUNS
// ============================================

export function useTroubadorRuns(filters: TroubadorRunFilters = {}) {
  return useQuery({
    queryKey: troubadorRunKeys.list(filters),
    queryFn: () =>
      apiClient.get<RunListResponse>('/troubador/runs', { params: { ...filters } }),
  });
}

export function useTroubadorRun(id: string) {
  return useQuery({
    queryKey: troubadorRunKeys.detail(id),
    queryFn: () => apiClient.get<RunDetail>(`/troubador/runs/${id}`),
    enabled: !!id,
  });
}

export function useCreateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateRunInput) =>
      apiClient.post<RunDetail>('/troubador/runs', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.lists() });
      showToast.created('Run');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create run');
    },
  });
}

export function useUpdateRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRunInput }) =>
      apiClient.patch<RunDetail>(`/troubador/runs/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.lists() });
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.detail(data.id) });
      showToast.updated('Run');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update run');
    },
  });
}

export function useUpdateProposals(runId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateProposalsInput) =>
      apiClient.patch<RunDetail>(`/troubador/runs/${runId}/proposals`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.detail(runId) });
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.lists() });
      showToast.updated('Topics');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update topics');
    },
  });
}

export function useCompleteInterview(runId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { transcript?: string }) =>
      apiClient.post<{ run_id: string; stage: string }>(
        `/troubador/runs/${runId}/interview-complete`,
        data ?? {}
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.detail(runId) });
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.lists() });
      showToast.success('Interview marked complete — writing can begin');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to mark interview complete');
    },
  });
}

// ============================================
// ARTICLES
// ============================================

export function useArticle(id: string) {
  return useQuery({
    queryKey: troubadorArticleKeys.detail(id),
    queryFn: () => apiClient.get<Article>(`/troubador/articles/${id}`),
    enabled: !!id,
  });
}

export function useUpdateArticle() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateArticleInput }) =>
      apiClient.patch<Article>(`/troubador/articles/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: troubadorArticleKeys.detail(data.id) });
      if (data.run_id) {
        queryClient.invalidateQueries({ queryKey: troubadorRunKeys.detail(data.run_id) });
      }
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.lists() });
      queryClient.invalidateQueries({ queryKey: troubadorCalendarKeys.all });
      showToast.updated('Article');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update article');
    },
  });
}

export function useAddArticleComment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      apiClient.post<Article>(`/troubador/articles/${id}/comments`, { content }),
    onSuccess: (data, { id }) => {
      queryClient.invalidateQueries({ queryKey: troubadorArticleKeys.detail(id) });
      const runId = data?.run_id;
      if (runId) {
        queryClient.invalidateQueries({ queryKey: troubadorRunKeys.detail(runId) });
      }
      queryClient.invalidateQueries({ queryKey: troubadorRunKeys.lists() });
      showToast.success('Feedback added');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to add feedback');
    },
  });
}

// ============================================
// SCHEDULES
// ============================================

export function useTroubadorSchedules(filters: TroubadorScheduleFilters = {}) {
  return useQuery({
    queryKey: troubadorScheduleKeys.list(filters),
    queryFn: () =>
      apiClient.get<ScheduleListResponse>('/troubador/schedules', {
        params: { ...filters },
      }),
  });
}

export function useSchedule(id: string) {
  return useQuery({
    queryKey: troubadorScheduleKeys.detail(id),
    queryFn: () => apiClient.get<Schedule>(`/troubador/schedules/${id}`),
    enabled: !!id,
  });
}

export function useCreateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateScheduleInput) =>
      apiClient.post<Schedule>('/troubador/schedules', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: troubadorScheduleKeys.lists() });
      showToast.created('Schedule');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to create schedule');
    },
  });
}

export function useUpdateSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateScheduleInput }) =>
      apiClient.patch<Schedule>(`/troubador/schedules/${id}`, data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: troubadorScheduleKeys.lists() });
      queryClient.invalidateQueries({ queryKey: troubadorScheduleKeys.detail(data.id) });
      showToast.updated('Schedule');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to update schedule');
    },
  });
}

export function useDeleteSchedule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.delete(`/troubador/schedules/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: troubadorScheduleKeys.lists() });
      showToast.deleted('Schedule');
    },
    onError: (error) => {
      showToast.apiError(error, 'Failed to delete schedule');
    },
  });
}

// ============================================
// CALENDAR
// ============================================

export function useTroubadorCalendar(siteId: string) {
  return useQuery({
    queryKey: troubadorCalendarKeys.bySite(siteId),
    queryFn: () =>
      apiClient.get<CalendarResponse>('/troubador/calendar', {
        params: { site_id: siteId },
      }),
    enabled: !!siteId,
  });
}

// ============================================
// EDITOR DASHBOARD QUEUE
// ============================================

export interface EditorQueueResponse {
  articles_awaiting_review: Array<{ id: string; title: string; run_id: string; run_title?: string }>;
  runs_in_planning: Array<{ id: string; title: string }>;
  runs_in_topic_selection: Array<{ id: string; title: string }>;
  runs_ready_for_interview: Array<{ id: string; title: string }>;
}

export function useTroubadorEditorQueue() {
  return useQuery({
    queryKey: ['troubador-editor-queue'],
    queryFn: () => apiClient.get<EditorQueueResponse>('/troubador/dashboard'),
  });
}
