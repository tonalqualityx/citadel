'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

/** A link to the project's plan (the Plan tab of its setup card), shown only when the project has one this person may read. */
export function ProjectPlanLink({ projectId }: { projectId: string }) {
  const { data } = useQuery({
    queryKey: ['project-plan-link', projectId],
    queryFn: async () => {
      try {
        return await apiClient.get<{ href: string; plan_lines: number }>(`/projects/${projectId}/plan`);
      } catch {
        return null;
      }
    },
    staleTime: 30_000,
    retry: 0,
  });
  if (!data) return null;
  return (
    <Link href={data.href} className="flex items-center gap-1 hover:text-primary" data-testid="project-plan-link">
      Plan{data.plan_lines > 0 ? ` (${data.plan_lines})` : ''}
    </Link>
  );
}
