'use client';

import * as React from 'react';
import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { type WizardStepId } from '@/lib/hooks/use-project-wizard';
import { cn } from '@/lib/utils/cn';

interface WizardStep {
  id: WizardStepId;
  number: number;
  title: string;
  description: string;
}

interface WizardLayoutProps {
  currentStepIndex: number;
  steps: readonly WizardStep[];
  children: React.ReactNode;
  onNext?: () => void;
  onPrev?: () => void;
  canProceed?: boolean;
  isGenerating?: boolean;
  showNavigation?: boolean;
}

export function WizardLayout({
  currentStepIndex,
  steps,
  children,
  onNext,
  onPrev,
  canProceed = true,
  isGenerating = false,
  showNavigation = true,
}: WizardLayoutProps) {
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === steps.length - 1;

  return (
    <div className="space-y-6">
      {/* Step Indicator */}
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <React.Fragment key={step.id}>
            <div className="flex flex-col items-center">
              <div
                className={cn(
                  'w-10 h-10 rounded-full flex items-center justify-center border-2 transition-colors',
                  index === currentStepIndex
                    ? 'bg-primary border-primary text-white'
                    : index < currentStepIndex
                    ? 'bg-green-500 border-green-500 text-white'
                    : 'bg-surface-2 border-border text-text-sub'
                )}
              >
                {index < currentStepIndex ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <span className="text-sm font-medium">{index + 1}</span>
                )}
              </div>
              <span
                className={cn(
                  'text-xs mt-1 hidden sm:block',
                  index === currentStepIndex ? 'text-primary font-medium' : 'text-text-sub'
                )}
              >
                {step.title}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  'flex-1 h-0.5 mx-2',
                  index < currentStepIndex ? 'bg-green-500' : 'bg-border'
                )}
              />
            )}
          </React.Fragment>
        ))}
      </div>

      {/* Step Content */}
      <Card className="p-6">{children}</Card>

      {/* Navigation */}
      {showNavigation && (
        <div className="flex justify-between">
          <Button
            variant="ghost"
            onClick={onPrev}
            disabled={isFirstStep || isGenerating}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>
          {!isLastStep ? (
            <Button onClick={onNext} disabled={!canProceed || isGenerating}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

interface StepHeaderProps {
  title: string;
  description?: string;
}

export function StepHeader({ title, description }: StepHeaderProps) {
  return (
    <div className="mb-6">
      <h2 className="text-xl font-semibold text-text-main">{title}</h2>
      {description && <p className="text-text-sub mt-1">{description}</p>}
    </div>
  );
}
