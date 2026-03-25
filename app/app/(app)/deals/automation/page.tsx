'use client';

import * as React from 'react';
import { Zap, ArrowLeft } from 'lucide-react';
import { AutomationRuleList } from '@/components/domain/automation/AutomationRuleList';
import { AutomationRuleForm } from '@/components/domain/automation/AutomationRuleForm';
import { useAutomationRule } from '@/lib/hooks/use-automation-rules';
import { Button } from '@/components/ui/button';

export default function AutomationPage() {
  const [mode, setMode] = React.useState<'list' | 'create' | 'edit'>('list');
  const [editingRuleId, setEditingRuleId] = React.useState<string | null>(null);
  const { data: editingRule } = useAutomationRule(editingRuleId || '');

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-2">
            <Zap className="h-6 w-6" />
            Sales Automation Rules
          </h1>
          <p className="text-text-sub">
            Configure automated actions triggered by accord status changes or time thresholds.
          </p>
        </div>
        {mode !== 'list' && (
          <Button
            variant="ghost"
            onClick={() => {
              setMode('list');
              setEditingRuleId(null);
            }}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to list
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="bg-surface rounded-lg border border-border-warm p-6">
        {mode === 'list' && (
          <AutomationRuleList
            onEdit={(id) => {
              setEditingRuleId(id);
              setMode('edit');
            }}
            onCreate={() => setMode('create')}
          />
        )}
        {mode === 'create' && (
          <AutomationRuleForm
            onClose={() => setMode('list')}
          />
        )}
        {mode === 'edit' && editingRule && (
          <AutomationRuleForm
            existing={editingRule}
            onClose={() => {
              setMode('list');
              setEditingRuleId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
