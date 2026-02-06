'use client';

import * as React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { useUpdateProject } from '@/lib/hooks/use-projects';
import { useAuth } from '@/lib/hooks/use-auth';

interface ProjectBriefTabProps {
  projectId: string;
  description: unknown;
}

export function ProjectBriefTab({ projectId, description }: ProjectBriefTabProps) {
  const updateProject = useUpdateProject();
  const { isPmOrAdmin } = useAuth();

  // Debounced save for description changes
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const handleDescriptionChange = React.useCallback(
    (newDescription: unknown) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        updateProject.mutate({
          id: projectId,
          data: { description: newDescription as any }
        });
      }, 500);
    },
    [updateProject, projectId]
  );

  return (
    <Card>
      <CardContent className="py-6">
        <RichTextEditor
          key={`brief-${projectId}`}
          content={description}
          onChange={handleDescriptionChange}
          placeholder="Describe the project's goals, scope, and key deliverables..."
          readOnly={!isPmOrAdmin}
        />
      </CardContent>
    </Card>
  );
}
