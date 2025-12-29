'use client';

import * as React from 'react';
import { Users, UserPlus } from 'lucide-react';
import { useRecipe } from '@/lib/hooks/use-recipes';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import { useUsers } from '@/lib/hooks/use-users';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';
import { StepHeader } from './wizard-layout';
import type { TeamAssignment } from '@/lib/hooks/use-project-wizard';

interface WizardStep4TeamProps {
  recipeId: string | null;
  teamAssignments: TeamAssignment[];
  onSetAssignment: (assignment: TeamAssignment) => void;
  onRemoveAssignment: (functionId: string) => void;
}

export function WizardStep4Team({
  recipeId,
  teamAssignments,
  onSetAssignment,
  onRemoveAssignment,
}: WizardStep4TeamProps) {
  const { data: recipeData, isLoading: recipeLoading } = useRecipe(recipeId || '', {
    enabled: !!recipeId,
  });
  const { data: functionsData, isLoading: functionsLoading } = useFunctions();
  const { data: usersData, isLoading: usersLoading } = useUsers();

  const isLoading = recipeLoading || functionsLoading || usersLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!recipeData) {
    return (
      <div className="text-center py-12 text-text-sub">
        Please select a recipe first
      </div>
    );
  }

  // Extract unique function IDs from recipe tasks (function comes from SOP)
  const recipeFunctionIds = new Set<string>();
  recipeData.phases?.forEach((phase) => {
    phase.tasks.forEach((task) => {
      if (task.sop?.function?.id) {
        recipeFunctionIds.add(task.sop.function.id);
      }
    });
  });

  const functions = functionsData?.functions || [];
  const users = usersData?.users || [];

  // Filter functions to only those used in the recipe
  const relevantFunctions = functions.filter((f) => recipeFunctionIds.has(f.id));

  // Get the current assignment for a function
  const getAssignment = (functionId: string) => {
    return teamAssignments.find((a) => a.functionId === functionId);
  };

  const handleAssignmentChange = (
    functionId: string,
    functionName: string,
    userId: string
  ) => {
    if (!userId) {
      onRemoveAssignment(functionId);
      return;
    }

    const user = users.find((u) => u.id === userId);
    if (user) {
      onSetAssignment({
        functionId,
        functionName,
        userId: user.id,
        userName: user.name,
      });
    }
  };

  return (
    <div>
      <StepHeader
        title="Assign Team Members"
        description="Map functions to team members. Tasks will be auto-assigned based on their function."
      />

      {relevantFunctions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-lg">
          <Users className="h-12 w-12 text-text-sub mb-4" />
          <p className="text-text-sub">No functions in this recipe</p>
          <p className="text-sm text-text-sub mt-1">
            Tasks don't have default functions assigned
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {relevantFunctions.map((func) => {
            const assignment = getAssignment(func.id);
            const taskCount = recipeData.phases?.reduce((count, phase) => {
              return (
                count +
                phase.tasks.filter((t) => t.sop?.function?.id === func.id).length
              );
            }, 0);

            return (
              <div
                key={func.id}
                className="flex items-center gap-4 p-4 rounded-lg border border-border bg-surface-1"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-main">{func.name}</span>
                    <Badge variant="default" className="text-xs">
                      {taskCount} task{taskCount !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                  {func.primary_focus && (
                    <p className="text-sm text-text-sub mt-1">{func.primary_focus}</p>
                  )}
                </div>

                <div className="w-64">
                  <Select
                    label="Assign to"
                    value={assignment?.userId || ''}
                    onChange={(value) =>
                      handleAssignmentChange(func.id, func.name, value)
                    }
                    options={[
                      { value: '', label: 'Unassigned' },
                      ...users.map((u) => ({
                        value: u.id,
                        label: u.name,
                      })),
                    ]}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Summary */}
      {teamAssignments.length > 0 && (
        <div className="mt-6 p-4 rounded-lg bg-surface-2">
          <div className="flex items-center gap-2 mb-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <span className="font-medium text-text-main">Team Summary</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {teamAssignments.map((a) => (
              <Badge key={a.functionId} variant="info">
                {a.functionName}: {a.userName}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
