'use client';

import * as React from 'react';
import { Zap, Plus, Pencil, Trash2 } from 'lucide-react';
import {
  useAutomationRules,
  useToggleAutomationRule,
  useDeleteAutomationRule,
} from '@/lib/hooks/use-automation-rules';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';

const TRIGGER_VARIANT: Record<string, 'default' | 'info'> = {
  status_change: 'default',
  time_based: 'info',
};

const ASSIGNEE_LABELS: Record<string, string> = {
  accord_owner: 'Accord Owner',
  meeting_attendees: 'Meeting Attendees',
  specific_user: 'Specific User',
};

interface AutomationRuleListProps {
  onEdit: (id: string) => void;
  onCreate: () => void;
}

export function AutomationRuleList({ onEdit, onCreate }: AutomationRuleListProps) {
  const { data, isLoading } = useAutomationRules();
  const toggleRule = useToggleAutomationRule();
  const deleteRule = useDeleteAutomationRule();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Automation Rules</CardTitle>
        <Button size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4 mr-1" />
          New Rule
        </Button>
      </CardHeader>
      <CardContent>
        {data?.rules && data.rules.length > 0 ? (
          <div className="space-y-3">
            {data.rules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between py-3 px-4 rounded-lg border border-border-warm"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-text-main">{rule.name}</div>
                    <div className="text-xs text-text-sub">
                      When status → {rule.trigger_status}
                      {rule.trigger_from_status && ` (from ${rule.trigger_from_status})`}
                      {rule.time_threshold_hours &&
                        ` after ${rule.time_threshold_hours}h`}
                      {' · '}
                      {ASSIGNEE_LABELS[rule.assignee_rule] || rule.assignee_rule}
                      {rule.assignee_user && ` (${rule.assignee_user.name})`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={TRIGGER_VARIANT[rule.trigger_type] || 'default'} size="sm">
                    {rule.trigger_type.replace('_', ' ')}
                  </Badge>
                  <Badge variant={rule.is_active ? 'success' : 'default'} size="sm">
                    {rule.is_active ? 'Active' : 'Inactive'}
                  </Badge>

                  {/* Toggle active */}
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rule.is_active}
                      onChange={() =>
                        toggleRule.mutate({ id: rule.id, is_active: !rule.is_active })
                      }
                      disabled={toggleRule.isPending}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-gray-300 peer-focus:outline-none rounded-full peer peer-checked:bg-brand-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
                  </label>

                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onEdit(rule.id)}
                    title="Edit rule"
                  >
                    <Pencil className="h-3.5 w-3.5 text-text-sub" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteRule.mutate(rule.id)}
                    disabled={deleteRule.isPending}
                    title="Delete rule"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-text-sub hover:text-red-500" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Zap className="h-8 w-8" />}
            title="No automation rules"
            description="Create rules to automatically generate tasks when accord statuses change."
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}
