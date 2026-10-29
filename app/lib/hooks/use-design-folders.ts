'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';
import { showToast } from '@/lib/hooks/use-toast';

// Admin-only Drive folder ids for the Designer Portal (design D11). Only /api/design/admin/* routes.
// The id shape matches DRIVE_ID_RE in lib/design/client-files.ts: 20 to 100 letters, digits, "_" or "-".

export type DesignFolderKind = 'clients' | 'projects';

export interface DesignFolder {
  id: string;
  drive_folder_id: string | null;
}

const DRIVE_ID_RE = /^[A-Za-z0-9_-]{20,100}$/;

export function isDriveFolderId(value: string): boolean {
  return DRIVE_ID_RE.test(value);
}

export const designFolderKeys = {
  detail: (kind: DesignFolderKind, id: string) => ['design-folder', kind, id] as const,
};

export function useDesignFolder(kind: DesignFolderKind, id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: designFolderKeys.detail(kind, id!),
    queryFn: async (): Promise<DesignFolder> => apiClient.get<DesignFolder>(`/design/admin/${kind}/${id}`),
    enabled: enabled && !!id,
  });
}

export function useSetDesignFolder(kind: DesignFolderKind, id: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (drive_folder_id: string | null) =>
      apiClient.patch<unknown>(`/design/admin/${kind}/${id}`, { drive_folder_id }),
    onSuccess: (_data, drive_folder_id) => {
      queryClient.setQueryData<DesignFolder>(designFolderKeys.detail(kind, id), { id, drive_folder_id });
      showToast.success(drive_folder_id ? 'Drive folder saved' : 'Drive folder cleared');
    },
    onError: (error) => {
      showToast.apiError(error, 'Could not update the Drive folder');
    },
  });
}
