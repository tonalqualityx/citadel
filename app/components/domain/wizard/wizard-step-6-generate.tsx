'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, CheckCircle, AlertCircle, Loader2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useGenerateProject, type WizardState } from '@/lib/hooks/use-project-wizard';
import { useRecipe } from '@/lib/hooks/use-recipes';
import { StepHeader } from './wizard-layout';
import type { MysteryFactor } from '@prisma/client';
import {
  energyToMinutes,
  getMysteryMultiplier,
  formatDuration,
} from '@/lib/calculations/energy';

interface WizardStep6GenerateProps {
  state: WizardState;
  onReset: () => void;
}

interface ProjectEstimatePreview {
  totalTaskCount: number;
  estimatedMinutesMin: number;
  estimatedMinutesMax: number;
  estimatedHoursMin: number;
  estimatedHoursMax: number;
  estimatedRange: string;
}

export function WizardStep6Generate({ state, onReset }: WizardStep6GenerateProps) {
  const router = useRouter();
  const generateProject = useGenerateProject();
  const [createdProjectId, setCreatedProjectId] = React.useState<string | null>(null);
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);

  // Fetch recipe to calculate estimates
  const { data: recipeData } = useRecipe(state.recipeId || '', {
    enabled: !!state.recipeId,
  });

  // Calculate estimates from recipe tasks (accounting for selective variable tasks)
  const estimates = React.useMemo((): ProjectEstimatePreview | null => {
    if (!recipeData?.phases) return null;

    let totalTaskCount = 0;
    let estimatedMinutesMin = 0;
    let estimatedMinutesMax = 0;

    recipeData.phases.forEach((phase) => {
      phase.tasks.forEach((task) => {
        // Determine how many tasks this will generate
        let taskMultiplier = 1;
        if (task.is_variable && task.variable_source === 'sitemap_page') {
          // Count pages that have this variable task selected
          taskMultiplier = state.pages.filter((p) =>
            p.selectedVariableTasks.includes(task.id)
          ).length;
        }

        // Skip if no tasks will be created
        if (taskMultiplier === 0) return;

        totalTaskCount += taskMultiplier;

        // Get estimates from the SOP (source of truth)
        const sop = task.sop;
        if (sop?.energy_estimate) {
          const baseMinutes = energyToMinutes(sop.energy_estimate);
          const mysteryFactor = (sop.mystery_factor || 'none') as MysteryFactor;
          const multiplier = getMysteryMultiplier(mysteryFactor);

          // Multiply by number of tasks generated
          estimatedMinutesMin += baseMinutes * taskMultiplier;
          estimatedMinutesMax += Math.round(baseMinutes * multiplier) * taskMultiplier;
        }
      });
    });

    const estimatedHoursMin = Math.round((estimatedMinutesMin / 60) * 10) / 10;
    const estimatedHoursMax = Math.round((estimatedMinutesMax / 60) * 10) / 10;

    let estimatedRange: string;
    if (estimatedHoursMin === estimatedHoursMax || estimatedMinutesMin === 0) {
      estimatedRange = estimatedHoursMin > 0 ? `${estimatedHoursMin} hrs` : 'No estimates';
    } else {
      estimatedRange = `${estimatedHoursMin}-${estimatedHoursMax} hrs`;
    }

    return {
      totalTaskCount,
      estimatedMinutesMin,
      estimatedMinutesMax,
      estimatedHoursMin,
      estimatedHoursMax,
      estimatedRange,
    };
  }, [recipeData, state.pages]);

  const handleGenerate = async () => {
    if (!state.recipeId || !state.clientId || !state.projectName.trim()) {
      setErrorMessage('Missing required fields');
      return;
    }

    try {
      setErrorMessage(null);
      const result = await generateProject.mutateAsync({
        recipe_id: state.recipeId,
        client_id: state.clientId,
        site_id: state.siteId || undefined,
        name: state.projectName.trim(),
        pages: state.pages.map((p) => ({
          name: p.name,
          page_type: p.pageType || undefined,
          selected_variable_tasks: p.selectedVariableTasks,
        })),
        team_assignments: state.teamAssignments.map((a) => ({
          function_id: a.functionId,
          user_id: a.userId,
        })),
        start_date: state.startDate || undefined,
        target_date: state.targetDate || undefined,
        notes: state.notes || undefined,
      });

      setCreatedProjectId(result.project.id);
    } catch (error) {
      console.error('Failed to generate project:', error);
      setErrorMessage(
        error instanceof Error ? error.message : 'Failed to generate project'
      );
    }
  };

  const handleViewProject = () => {
    if (createdProjectId) {
      router.push(`/projects/${createdProjectId}`);
    }
  };

  const handleCreateAnother = () => {
    onReset();
  };

  // Initial state - ready to generate
  if (!generateProject.isPending && !createdProjectId && !errorMessage) {
    return (
      <div className="text-center py-8">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-6">
          <Sparkles className="h-10 w-10 text-primary" />
        </div>

        <StepHeader
          title="Ready to Generate"
          description="All set! Review the summary below and click Generate to create your project."
        />

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl mx-auto mb-8">
          {/* Summary Card */}
          <div className="bg-surface-2 rounded-lg p-6 text-left">
            <h3 className="font-medium text-text-main mb-4">Project Details</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-text-sub">Project:</dt>
                <dd className="text-text-main font-medium truncate ml-2">{state.projectName}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-sub">Client:</dt>
                <dd className="text-text-main">{state.clientName}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-text-sub">Recipe:</dt>
                <dd className="text-text-main">{state.recipeName}</dd>
              </div>
              {state.requiresSitemap && (
                <div className="flex justify-between">
                  <dt className="text-text-sub">Pages:</dt>
                  <dd className="text-text-main">{state.pages.length}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-text-sub">Team Assignments:</dt>
                <dd className="text-text-main">{state.teamAssignments.length}</dd>
              </div>
            </dl>
          </div>

          {/* Estimates Card */}
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-6 text-left">
            <div className="flex items-center gap-2 mb-4">
              <Clock className="h-5 w-5 text-primary" />
              <h3 className="font-medium text-text-main">Estimated Effort</h3>
            </div>
            {estimates ? (
              <div className="space-y-4">
                <div>
                  <p className="text-2xl font-bold text-primary">{estimates.estimatedRange}</p>
                  <p className="text-xs text-text-sub mt-1">
                    {estimates.estimatedHoursMin !== estimates.estimatedHoursMax
                      ? 'Range accounts for uncertainty'
                      : 'Based on task estimates'}
                  </p>
                </div>
                <div className="pt-3 border-t border-primary/20">
                  <div className="flex justify-between text-sm">
                    <span className="text-text-sub">Tasks to create:</span>
                    <span className="text-text-main font-medium">{estimates.totalTaskCount}</span>
                  </div>
                  {estimates.estimatedMinutesMin > 0 && (
                    <>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-text-sub">Min estimate:</span>
                        <span className="text-text-main">{formatDuration(estimates.estimatedMinutesMin)}</span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-text-sub">Max estimate:</span>
                        <span className="text-text-main">{formatDuration(estimates.estimatedMinutesMax)}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-text-sub text-sm">Loading estimates...</p>
            )}
          </div>
        </div>

        <Button size="lg" onClick={handleGenerate}>
          <Sparkles className="h-5 w-5 mr-2" />
          Generate Project
        </Button>
      </div>
    );
  }

  // Generating
  if (generateProject.isPending) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-primary/10 mb-6">
          <Loader2 className="h-10 w-10 text-primary animate-spin" />
        </div>

        <h2 className="text-xl font-semibold text-text-main mb-2">
          Generating Project...
        </h2>
        <p className="text-text-sub">
          Creating project, pages, team assignments, and tasks...
        </p>
      </div>
    );
  }

  // Error state
  if (errorMessage) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-red-500/10 mb-6">
          <AlertCircle className="h-10 w-10 text-red-500" />
        </div>

        <h2 className="text-xl font-semibold text-text-main mb-2">
          Generation Failed
        </h2>
        <p className="text-text-sub mb-6">{errorMessage}</p>

        <div className="flex justify-center gap-4">
          <Button variant="secondary" onClick={() => setErrorMessage(null)}>
            Try Again
          </Button>
          <Button variant="ghost" onClick={onReset}>
            Start Over
          </Button>
        </div>
      </div>
    );
  }

  // Success state
  if (createdProjectId) {
    return (
      <div className="text-center py-12">
        <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-500/10 mb-6">
          <CheckCircle className="h-10 w-10 text-green-500" />
        </div>

        <h2 className="text-xl font-semibold text-text-main mb-2">
          Project Created Successfully!
        </h2>
        <p className="text-text-sub mb-4">
          Your project "{state.projectName}" has been created.
        </p>

        {estimates && estimates.totalTaskCount > 0 && (
          <div className="mb-8">
            <Badge variant="success" className="text-sm">
              {estimates.totalTaskCount} tasks created
            </Badge>
            {estimates.estimatedMinutesMin > 0 && (
              <p className="text-sm text-text-sub mt-2">
                Estimated effort: {estimates.estimatedRange}
              </p>
            )}
          </div>
        )}

        <div className="flex justify-center gap-4">
          <Button onClick={handleViewProject}>
            View Project
          </Button>
          <Button variant="secondary" onClick={handleCreateAnother}>
            Create Another
          </Button>
        </div>
      </div>
    );
  }

  return null;
}
