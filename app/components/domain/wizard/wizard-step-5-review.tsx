'use client';

import * as React from 'react';
import {
  BookOpen,
  Building2,
  Globe,
  FileText,
  Users,
  Calendar,
  Edit2,
} from 'lucide-react';
import { useRecipe } from '@/lib/hooks/use-recipes';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { StepHeader } from './wizard-layout';
import type { WizardState, WizardStepId } from '@/lib/hooks/use-project-wizard';

interface WizardStep5ReviewProps {
  state: WizardState;
  onUpdateState: (updates: Partial<WizardState>) => void;
  onGoToStep: (stepId: WizardStepId) => void;
}

export function WizardStep5Review({
  state,
  onUpdateState,
  onGoToStep,
}: WizardStep5ReviewProps) {
  const { data: recipeData, isLoading } = useRecipe(state.recipeId || '', {
    enabled: !!state.recipeId,
  });

  // Calculate expected task count (accounting for selective variable tasks)
  const calculateTaskCount = () => {
    if (!recipeData?.phases) return 0;

    let count = 0;
    recipeData.phases.forEach((phase) => {
      phase.tasks.forEach((task) => {
        if (task.is_variable && task.variable_source === 'sitemap_page') {
          // Count pages that have this variable task selected
          const selectedCount = state.pages.filter((p) =>
            p.selectedVariableTasks.includes(task.id)
          ).length;
          count += selectedCount;
        } else {
          count += 1;
        }
      });
    });
    return count;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  const taskCount = calculateTaskCount();

  return (
    <div>
      <StepHeader
        title="Review & Configure"
        description="Review your selections and configure project details"
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column - Summary */}
        <div className="space-y-4">
          {/* Recipe */}
          <SummaryCard
            icon={<BookOpen className="h-5 w-5" />}
            title="Recipe"
            onEdit={() => onGoToStep('recipe')}
          >
            <p className="font-medium text-text-main">{state.recipeName}</p>
            {recipeData && (
              <p className="text-sm text-text-sub mt-1">
                {recipeData.phases?.length || 0} phases,{' '}
                {recipeData.phases?.reduce((sum, p) => sum + p.tasks.length, 0) || 0} template tasks
              </p>
            )}
          </SummaryCard>

          {/* Client & Site */}
          <SummaryCard
            icon={<Building2 className="h-5 w-5" />}
            title="Client & Site"
            onEdit={() => onGoToStep('client')}
          >
            <p className="font-medium text-text-main">{state.clientName}</p>
            {state.siteName && (
              <div className="flex items-center gap-1 mt-1">
                <Globe className="h-4 w-4 text-text-sub" />
                <span className="text-sm text-text-sub">{state.siteName}</span>
              </div>
            )}
          </SummaryCard>

          {/* Pages - Only show if recipe requires sitemap */}
          {state.requiresSitemap && (
            <SummaryCard
              icon={<FileText className="h-5 w-5" />}
              title="Sitemap"
              onEdit={() => onGoToStep('sitemap')}
            >
              {state.pages.length === 0 ? (
                <p className="text-text-sub italic">No pages defined</p>
              ) : (
                <>
                  <p className="font-medium text-text-main">
                    {state.pages.length} page{state.pages.length !== 1 ? 's' : ''}
                  </p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {state.pages.slice(0, 6).map((page, i) => (
                      <Badge key={i} variant="default">
                        {page.name}
                      </Badge>
                    ))}
                    {state.pages.length > 6 && (
                      <Badge variant="default">+{state.pages.length - 6} more</Badge>
                    )}
                  </div>
                </>
              )}
            </SummaryCard>
          )}

          {/* Team */}
          <SummaryCard
            icon={<Users className="h-5 w-5" />}
            title="Team"
            onEdit={() => onGoToStep('team')}
          >
            {state.teamAssignments.length === 0 ? (
              <p className="text-text-sub italic">No team assignments</p>
            ) : (
              <div className="space-y-1">
                {state.teamAssignments.map((a) => (
                  <p key={a.functionId} className="text-sm">
                    <span className="text-text-sub">{a.functionName}:</span>{' '}
                    <span className="text-text-main">{a.userName}</span>
                  </p>
                ))}
              </div>
            )}
          </SummaryCard>

          {/* Task Summary */}
          <div className="p-4 rounded-lg bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-2 mb-2">
              <Calendar className="h-5 w-5 text-primary" />
              <span className="font-medium text-text-main">Expected Output</span>
            </div>
            <p className="text-2xl font-bold text-primary">{taskCount} Tasks</p>
            <p className="text-sm text-text-sub mt-1">
              Will be created from the selected recipe
            </p>
          </div>
        </div>

        {/* Right column - Configuration */}
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              Project Name *
            </label>
            <Input
              value={state.projectName}
              onChange={(e) => onUpdateState({ projectName: e.target.value })}
              placeholder="e.g., Website Redesign for Acme Corp"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                Start Date
              </label>
              <Input
                type="date"
                value={state.startDate || ''}
                onChange={(e) =>
                  onUpdateState({ startDate: e.target.value || null })
                }
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                Target Date
              </label>
              <Input
                type="date"
                value={state.targetDate || ''}
                onChange={(e) =>
                  onUpdateState({ targetDate: e.target.value || null })
                }
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              Notes
            </label>
            <Textarea
              value={state.notes}
              onChange={(e) => onUpdateState({ notes: e.target.value })}
              placeholder="Optional project notes..."
              rows={4}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

interface SummaryCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  onEdit: () => void;
}

function SummaryCard({ icon, title, children, onEdit }: SummaryCardProps) {
  return (
    <div className="p-4 rounded-lg border border-border bg-surface-1 group">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-primary">{icon}</span>
          <span className="font-medium text-text-main">{title}</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Edit2 className="h-4 w-4" />
        </Button>
      </div>
      {children}
    </div>
  );
}
