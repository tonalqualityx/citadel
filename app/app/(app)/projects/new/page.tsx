'use client';

import * as React from 'react';
import Link from 'next/link';
import { ArrowLeft, Wand2 } from 'lucide-react';
import { useProjectWizard } from '@/lib/hooks/use-project-wizard';
import { Button } from '@/components/ui/button';
import {
  WizardLayout,
  WizardStep1Recipe,
  WizardStep2Client,
  WizardStep3Sitemap,
  WizardStep4Team,
  WizardStep5Review,
  WizardStep6Generate,
} from '@/components/domain/wizard';

export default function NewProjectWizardPage() {
  const wizard = useProjectWizard();

  const renderStep = () => {
    switch (wizard.currentStepId) {
      case 'recipe':
        return (
          <WizardStep1Recipe
            selectedRecipeId={wizard.state.recipeId}
            onSelect={(recipeId, recipeName, requiresSitemap) =>
              wizard.updateState({ recipeId, recipeName, requiresSitemap })
            }
          />
        );
      case 'client':
        return (
          <WizardStep2Client
            selectedClientId={wizard.state.clientId}
            selectedClientName={wizard.state.clientName}
            selectedSiteId={wizard.state.siteId}
            selectedSiteName={wizard.state.siteName}
            onSelectClient={(clientId, clientName) =>
              wizard.updateState({ clientId, clientName })
            }
            onSelectSite={(siteId, siteName) =>
              wizard.updateState({ siteId, siteName })
            }
          />
        );
      case 'sitemap':
        return (
          <WizardStep3Sitemap
            recipeId={wizard.state.recipeId!}
            pages={wizard.state.pages}
            onAddPage={wizard.addPage}
            onUpdatePage={wizard.updatePage}
            onRemovePage={wizard.removePage}
            onSetPages={wizard.setPages}
            onToggleTask={wizard.togglePageVariableTask}
            onSelectAllColumn={wizard.selectAllForColumn}
            onClearAllColumn={wizard.clearAllForColumn}
            onSetPageVariableTasks={wizard.setPageVariableTasks}
          />
        );
      case 'team':
        return (
          <WizardStep4Team
            recipeId={wizard.state.recipeId}
            teamAssignments={wizard.state.teamAssignments}
            onSetAssignment={wizard.setTeamAssignment}
            onRemoveAssignment={wizard.removeTeamAssignment}
          />
        );
      case 'review':
        return (
          <WizardStep5Review
            state={wizard.state}
            onUpdateState={wizard.updateState}
            onGoToStep={wizard.goToStep}
          />
        );
      case 'generate':
        return (
          <WizardStep6Generate state={wizard.state} onReset={wizard.reset} />
        );
      default:
        return null;
    }
  };

  const isLastStep = wizard.currentStepId === 'generate';

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/projects">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-2">
          <Wand2 className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold text-text-main">
            New Project Wizard
          </h1>
        </div>
      </div>

      {/* Wizard */}
      <WizardLayout
        currentStepIndex={wizard.currentStepIndex}
        steps={wizard.steps}
        onNext={wizard.nextStep}
        onPrev={wizard.prevStep}
        canProceed={wizard.canProceed}
        showNavigation={!isLastStep}
      >
        {renderStep()}
      </WizardLayout>
    </div>
  );
}
