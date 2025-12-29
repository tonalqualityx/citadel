'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowRight, FolderKanban, Building2 } from 'lucide-react';
import { DashboardProject } from '@/lib/hooks/use-dashboard';
import { Badge } from '@/components/ui/badge';

interface ProjectQuickListProps {
  projects: DashboardProject[];
  emptyMessage?: string;
  showClient?: boolean;
  showTaskCount?: boolean;
  maxItems?: number;
}

const statusColors: Record<string, string> = {
  draft: 'bg-gray-500/10 text-gray-500',
  planning: 'bg-blue-500/10 text-blue-500',
  ready: 'bg-emerald-500/10 text-emerald-500',
  in_progress: 'bg-blue-500/10 text-blue-500',
  review: 'bg-purple-500/10 text-purple-500',
  done: 'bg-emerald-500/10 text-emerald-500',
  on_hold: 'bg-amber-500/10 text-amber-500',
  cancelled: 'bg-red-500/10 text-red-500',
};

const statusLabels: Record<string, string> = {
  draft: 'Draft',
  planning: 'Planning',
  ready: 'Ready',
  in_progress: 'In Progress',
  review: 'Review',
  done: 'Done',
  on_hold: 'On Hold',
  cancelled: 'Cancelled',
};

export function ProjectQuickList({
  projects,
  emptyMessage = 'No projects',
  showClient = true,
  showTaskCount = true,
  maxItems = 10,
}: ProjectQuickListProps) {
  const displayProjects = projects.slice(0, maxItems);

  if (displayProjects.length === 0) {
    return (
      <div className="text-center py-6 text-text-sub">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {displayProjects.map((project) => (
        <Link key={project.id} href={`/projects/${project.id}`}>
          <div className="group flex items-center justify-between p-2 rounded-lg hover:bg-surface-2 transition-colors">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <FolderKanban className="h-4 w-4 text-text-sub" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-main truncate">
                    {project.name}
                  </span>
                  <Badge variant="default" className={statusColors[project.status]}>
                    {statusLabels[project.status] || project.status}
                  </Badge>
                </div>
                <div className="flex items-center gap-2 text-xs text-text-sub">
                  {showClient && project.client && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {project.client.name}
                    </span>
                  )}
                  {showTaskCount && (
                    <span>{project.taskCount} open tasks</span>
                  )}
                </div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-text-sub opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </Link>
      ))}
    </div>
  );
}
