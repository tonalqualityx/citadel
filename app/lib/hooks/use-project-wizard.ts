'use client';

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { apiClient } from '@/lib/api/client';

export interface WizardPage {
  id: string;
  name: string;
  pageType: string;
  depth: number; // 0 = top level, 1 = child, 2 = grandchild, etc.
  selectedVariableTasks: string[]; // Recipe task IDs for variable tasks that apply to this page
}

export interface TeamAssignment {
  functionId: string;
  functionName: string;
  userId: string;
  userName: string;
}

export interface WizardState {
  // Step 1: Recipe
  recipeId: string | null;
  recipeName: string | null;
  requiresSitemap: boolean; // From recipe.requires_sitemap

  // Step 2: Client & Site
  clientId: string | null;
  clientName: string | null;
  siteId: string | null;
  siteName: string | null;

  // Step 3: Sitemap (conditional based on requiresSitemap)
  pages: WizardPage[];

  // Step 4: Team
  teamAssignments: TeamAssignment[];

  // Step 5: Configuration
  projectName: string;
  startDate: string | null;
  targetDate: string | null;
  notes: string;
}

const initialState: WizardState = {
  recipeId: null,
  recipeName: null,
  requiresSitemap: false,
  clientId: null,
  clientName: null,
  siteId: null,
  siteName: null,
  pages: [],
  teamAssignments: [],
  projectName: '',
  startDate: null,
  targetDate: null,
  notes: '',
};

// All possible steps (sitemap is conditional)
export const WIZARD_STEPS_ALL = [
  { id: 'recipe', number: 1, title: 'Recipe', description: 'Select a project template' },
  { id: 'client', number: 2, title: 'Client', description: 'Choose client and site' },
  { id: 'sitemap', number: 3, title: 'Sitemap', description: 'Define project pages' },
  { id: 'team', number: 4, title: 'Team', description: 'Assign team members' },
  { id: 'review', number: 5, title: 'Review', description: 'Configure and confirm' },
  { id: 'generate', number: 6, title: 'Generate', description: 'Create the project' },
] as const;

// Steps when sitemap is NOT required
export const WIZARD_STEPS_NO_SITEMAP = [
  { id: 'recipe', number: 1, title: 'Recipe', description: 'Select a project template' },
  { id: 'client', number: 2, title: 'Client', description: 'Choose client and site' },
  { id: 'team', number: 3, title: 'Team', description: 'Assign team members' },
  { id: 'review', number: 4, title: 'Review', description: 'Configure and confirm' },
  { id: 'generate', number: 5, title: 'Generate', description: 'Create the project' },
] as const;

// For backwards compatibility
export const WIZARD_STEPS = WIZARD_STEPS_ALL;

export type WizardStepId = 'recipe' | 'client' | 'sitemap' | 'team' | 'review' | 'generate';
export type WizardStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

// Helper to get steps based on whether sitemap is required
export function getWizardSteps(requiresSitemap: boolean) {
  return requiresSitemap ? WIZARD_STEPS_ALL : WIZARD_STEPS_NO_SITEMAP;
}

interface CreateProjectFromWizardInput {
  recipe_id: string;
  client_id: string;
  site_id?: string;
  name: string;
  pages: Array<{
    name: string;
    page_type?: string;
    selected_variable_tasks: string[]; // Recipe task IDs
  }>;
  team_assignments: Array<{
    function_id: string;
    user_id: string;
  }>;
  start_date?: string;
  target_date?: string;
  notes?: string;
}

export function useProjectWizard() {
  const [currentStepId, setCurrentStepId] = useState<WizardStepId>('recipe');
  const [state, setState] = useState<WizardState>(initialState);

  // Get the current steps based on whether sitemap is required
  const steps = getWizardSteps(state.requiresSitemap);
  const currentStepIndex = steps.findIndex((s) => s.id === currentStepId);
  const currentStep = steps[currentStepIndex];

  const updateState = useCallback((updates: Partial<WizardState>) => {
    setState((prev) => ({ ...prev, ...updates }));
  }, []);

  const nextStep = useCallback(() => {
    const steps = getWizardSteps(state.requiresSitemap);
    const currentIndex = steps.findIndex((s) => s.id === currentStepId);
    if (currentIndex < steps.length - 1) {
      setCurrentStepId(steps[currentIndex + 1].id);
    }
  }, [currentStepId, state.requiresSitemap]);

  const prevStep = useCallback(() => {
    const steps = getWizardSteps(state.requiresSitemap);
    const currentIndex = steps.findIndex((s) => s.id === currentStepId);
    if (currentIndex > 0) {
      setCurrentStepId(steps[currentIndex - 1].id);
    }
  }, [currentStepId, state.requiresSitemap]);

  const goToStep = useCallback((stepId: WizardStepId) => {
    setCurrentStepId(stepId);
  }, []);

  // Legacy support for numeric step navigation
  const goToStepNumber = useCallback((stepNumber: WizardStepNumber) => {
    const steps = getWizardSteps(state.requiresSitemap);
    const step = steps.find((s) => s.number === stepNumber);
    if (step) {
      setCurrentStepId(step.id);
    }
  }, [state.requiresSitemap]);

  const reset = useCallback(() => {
    setCurrentStepId('recipe');
    setState(initialState);
  }, []);

  // Validation helpers
  const canProceedFromStep = useCallback(
    (stepId: WizardStepId): boolean => {
      switch (stepId) {
        case 'recipe':
          return !!state.recipeId;
        case 'client':
          return !!state.clientId;
        case 'sitemap':
          // Pages are optional
          return true;
        case 'team':
          // Team assignments are optional
          return true;
        case 'review':
          return !!state.projectName.trim();
        case 'generate':
          return false; // Final step
        default:
          return false;
      }
    },
    [state]
  );

  // Helper to check if we can proceed from the current step
  const canProceed = canProceedFromStep(currentStepId);

  // Page management helpers
  const addPage = useCallback(
    (page: Omit<WizardPage, 'id'> & { id?: string }) => {
      const newPage: WizardPage = {
        id: page.id || crypto.randomUUID(),
        name: page.name,
        pageType: page.pageType,
        depth: page.depth ?? 0,
        selectedVariableTasks: page.selectedVariableTasks || [],
      };
      setState((prev) => ({
        ...prev,
        pages: [...prev.pages, newPage],
      }));
    },
    []
  );

  const updatePage = useCallback((id: string, updates: Partial<WizardPage>) => {
    setState((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => (p.id === id ? { ...p, ...updates } : p)),
    }));
  }, []);

  const removePage = useCallback((id: string) => {
    setState((prev) => ({
      ...prev,
      pages: prev.pages.filter((p) => p.id !== id),
    }));
  }, []);

  const setPages = useCallback((pages: WizardPage[]) => {
    setState((prev) => ({ ...prev, pages }));
  }, []);

  // Variable task selection helpers
  const setPageVariableTasks = useCallback((pageId: string, taskIds: string[]) => {
    setState((prev) => ({
      ...prev,
      pages: prev.pages.map((p) =>
        p.id === pageId ? { ...p, selectedVariableTasks: taskIds } : p
      ),
    }));
  }, []);

  const togglePageVariableTask = useCallback((pageId: string, taskId: string) => {
    setState((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => {
        if (p.id !== pageId) return p;
        const hasTask = p.selectedVariableTasks.includes(taskId);
        return {
          ...p,
          selectedVariableTasks: hasTask
            ? p.selectedVariableTasks.filter((id) => id !== taskId)
            : [...p.selectedVariableTasks, taskId],
        };
      }),
    }));
  }, []);

  const selectAllForColumn = useCallback((taskId: string) => {
    setState((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => ({
        ...p,
        selectedVariableTasks: p.selectedVariableTasks.includes(taskId)
          ? p.selectedVariableTasks
          : [...p.selectedVariableTasks, taskId],
      })),
    }));
  }, []);

  const clearAllForColumn = useCallback((taskId: string) => {
    setState((prev) => ({
      ...prev,
      pages: prev.pages.map((p) => ({
        ...p,
        selectedVariableTasks: p.selectedVariableTasks.filter((id) => id !== taskId),
      })),
    }));
  }, []);

  // Team assignment helpers
  const setTeamAssignment = useCallback((assignment: TeamAssignment) => {
    setState((prev) => {
      const existing = prev.teamAssignments.findIndex(
        (a) => a.functionId === assignment.functionId
      );
      if (existing >= 0) {
        const updated = [...prev.teamAssignments];
        updated[existing] = assignment;
        return { ...prev, teamAssignments: updated };
      }
      return {
        ...prev,
        teamAssignments: [...prev.teamAssignments, assignment],
      };
    });
  }, []);

  const removeTeamAssignment = useCallback((functionId: string) => {
    setState((prev) => ({
      ...prev,
      teamAssignments: prev.teamAssignments.filter(
        (a) => a.functionId !== functionId
      ),
    }));
  }, []);

  return {
    // Step navigation (using step IDs)
    currentStepId,
    currentStep,
    currentStepIndex,
    steps,
    // Legacy: currentStep as number for backwards compatibility
    currentStepNumber: currentStep?.number || 1,
    // State
    state,
    updateState,
    // Navigation
    nextStep,
    prevStep,
    goToStep,
    goToStepNumber, // Legacy support
    reset,
    // Validation
    canProceedFromStep,
    canProceed,
    // Page helpers
    addPage,
    updatePage,
    removePage,
    setPages,
    // Variable task selection helpers
    setPageVariableTasks,
    togglePageVariableTask,
    selectAllForColumn,
    clearAllForColumn,
    // Team helpers
    setTeamAssignment,
    removeTeamAssignment,
  };
}

// Mutation hook for generating the project
export function useGenerateProject() {
  return useMutation({
    mutationFn: (data: CreateProjectFromWizardInput) =>
      apiClient.post<{ project: { id: string; name: string } }>(
        '/projects/wizard',
        data
      ),
  });
}
