'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient, useMutation } from '@tanstack/react-query';
import { Plus, X, GripVertical, ClipboardCheck, Settings } from 'lucide-react';
import { apiClient } from '@/lib/api/client';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  PriorityFormSelect,
  EnergyFormSelect,
  MysteryFormSelect,
  BatteryFormSelect,
} from '@/components/ui/field-selects';
import {
  SectionedRequirementsEditor,
  type RequirementEntry,
} from '@/components/ui/sectioned-requirements-editor';

interface TemplateRequirement {
  id: string;
  text: string;
  sort_order: number;
}

interface Sop {
  id: string;
  title: string;
  content?: unknown;
  function?: { id: string; name: string } | null;
  estimated_minutes: number | null;
  tags: string[];
  is_active: boolean;
  // Task template fields
  default_priority?: number;
  energy_estimate?: number | null;
  mystery_factor?: string;
  battery_impact?: string;
  template_requirements?: TemplateRequirement[] | null;
  setup_requirements?: TemplateRequirement[] | null;
  review_requirements?: TemplateRequirement[] | null;
}

interface SopFormProps {
  sop?: Sop;
}

export function SopForm({ sop }: SopFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: functionsData } = useFunctions();

  // Basic SOP fields
  const [title, setTitle] = React.useState(sop?.title || '');
  const [content, setContent] = React.useState<unknown>(sop?.content || null);
  const [functionId, setFunctionId] = React.useState(sop?.function?.id || '');
  const [isActive, setIsActive] = React.useState(sop?.is_active ?? true);

  // Task template fields
  const [defaultPriority, setDefaultPriority] = React.useState(
    sop?.default_priority?.toString() || '3'
  );
  const [energyEstimate, setEnergyEstimate] = React.useState(
    sop?.energy_estimate?.toString() || ''
  );
  const [mysteryFactor, setMysteryFactor] = React.useState(
    sop?.mystery_factor || 'none'
  );
  const [batteryImpact, setBatteryImpact] = React.useState(
    sop?.battery_impact || 'average_drain'
  );
  const [templateRequirements, setTemplateRequirements] = React.useState<RequirementEntry[]>(
    (sop?.template_requirements as RequirementEntry[] | null) || []
  );
  const [setupRequirements, setSetupRequirements] = React.useState<TemplateRequirement[]>(
    sop?.setup_requirements || []
  );
  const [reviewRequirements, setReviewRequirements] = React.useState<TemplateRequirement[]>(
    sop?.review_requirements || []
  );

  const functionOptions = React.useMemo(
    () =>
      functionsData?.functions?.map((f) => ({
        value: f.id,
        label: f.name,
      })) || [],
    [functionsData]
  );

  const mutation = useMutation({
    mutationFn: async (data: any) => {
      if (sop) {
        return apiClient.patch(`/sops/${sop.id}`, data);
      }
      return apiClient.post('/sops', data);
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ['sops'] });
      router.push(`/sops/${result.sop?.id || sop?.id}`);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;

    mutation.mutate({
      title: title.trim(),
      content,
      function_id: functionId || null,
      is_active: isActive,
      // Task template fields
      default_priority: parseInt(defaultPriority),
      energy_estimate: energyEstimate ? parseInt(energyEstimate) : null,
      mystery_factor: mysteryFactor,
      battery_impact: batteryImpact,
      template_requirements: templateRequirements.length > 0 ? templateRequirements : null,
      setup_requirements: setupRequirements.length > 0 ? setupRequirements : null,
      review_requirements: reviewRequirements.length > 0 ? reviewRequirements : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Basic SOP Details */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">SOP Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="SOP title"
            required
          />

          <Select
            label="Function"
            options={functionOptions}
            value={functionId}
            onChange={setFunctionId}
            placeholder="Select function (optional)"
          />
        </CardContent>
      </Card>

      {/* Task Template Defaults */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Task Template Defaults</CardTitle>
          <p className="text-sm text-text-sub">
            When creating tasks from this SOP, these values will be used as defaults.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PriorityFormSelect
              label="Default Priority"
              value={defaultPriority}
              onChange={setDefaultPriority}
            />

            <EnergyFormSelect
              label="Energy Estimate"
              value={energyEstimate}
              onChange={setEnergyEstimate}
            />

            <MysteryFormSelect
              label="Mystery Factor"
              value={mysteryFactor}
              onChange={setMysteryFactor}
            />

            <BatteryFormSelect
              label="Battery Impact"
              value={batteryImpact}
              onChange={setBatteryImpact}
            />
          </div>
        </CardContent>
      </Card>

      {/* Template Requirements */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Task Requirements</CardTitle>
          <p className="text-sm text-text-sub">
            Checklist items visible to anyone assigned to the task.
          </p>
        </CardHeader>
        <CardContent>
          <SectionedRequirementsEditor
            requirements={templateRequirements}
            onChange={setTemplateRequirements}
            emptyMessage="No template requirements. Tasks created from this SOP will start with an empty checklist."
          />
        </CardContent>
      </Card>

      {/* PM/Admin Checklists */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Setup Checklist - PM/Admin only */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings className="h-5 w-5" />
              Setup
              <Badge variant="warning" className="text-xs">PM/Admin</Badge>
            </CardTitle>
            <p className="text-sm text-text-sub">
              Checklist for prepping tasks before assignment. Not visible to techs.
            </p>
          </CardHeader>
          <CardContent>
            <TemplateRequirementsEditor
              requirements={setupRequirements}
              onChange={setSetupRequirements}
            />
          </CardContent>
        </Card>

        {/* Review Checklist - PM/Admin only */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5" />
              Review
              <Badge variant="warning" className="text-xs">PM/Admin</Badge>
            </CardTitle>
            <p className="text-sm text-text-sub">
              Checklist for reviewing completed tasks. Not visible to techs.
            </p>
          </CardHeader>
          <CardContent>
            <TemplateRequirementsEditor
              requirements={reviewRequirements}
              onChange={setReviewRequirements}
            />
          </CardContent>
        </Card>
      </div>

      {/* Content / Instructions */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Instructions</CardTitle>
          <p className="text-sm text-text-sub">
            Step-by-step instructions for completing tasks using this SOP.
          </p>
        </CardHeader>
        <CardContent>
          <RichTextEditor
            content={content}
            onChange={setContent}
            placeholder="Write your SOP instructions here..."
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
            className="h-4 w-4 rounded border-border-warm text-primary focus:ring-primary"
          />
          <span className="text-sm text-text-main">Active</span>
        </label>

        <div className="flex gap-3">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={mutation.isPending || !title.trim()}>
            {mutation.isPending ? 'Saving...' : sop ? 'Save Changes' : 'Create SOP'}
          </Button>
        </div>
      </div>
    </form>
  );
}

// Template Requirements Editor Component
function TemplateRequirementsEditor({
  requirements,
  onChange,
}: {
  requirements: TemplateRequirement[];
  onChange: (requirements: TemplateRequirement[]) => void;
}) {
  const [newRequirement, setNewRequirement] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleAdd = () => {
    if (!newRequirement.trim()) return;

    const newReq: TemplateRequirement = {
      id: crypto.randomUUID(),
      text: newRequirement.trim(),
      sort_order: requirements.length,
    };

    onChange([...requirements, newReq]);
    setNewRequirement('');
  };

  const handleRemove = (id: string) => {
    onChange(requirements.filter((req) => req.id !== id));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
    if (e.key === 'Escape') {
      setIsAdding(false);
      setNewRequirement('');
    }
  };

  const handleUpdateText = (id: string, newText: string) => {
    onChange(
      requirements.map((req) =>
        req.id === id ? { ...req, text: newText } : req
      )
    );
  };

  return (
    <div className="space-y-3">
      {/* Requirements List */}
      {requirements.length > 0 && (
        <div className="space-y-2">
          {requirements.map((req, index) => (
            <div
              key={req.id}
              className="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface-1 group"
            >
              <GripVertical className="h-4 w-4 text-text-sub flex-shrink-0" />
              <span className="text-sm text-text-sub w-6">{index + 1}.</span>
              <input
                type="text"
                value={req.text}
                onChange={(e) => handleUpdateText(req.id, e.target.value)}
                className="flex-1 bg-transparent text-sm text-text-main focus:outline-none"
              />
              <button
                type="button"
                onClick={() => handleRemove(req.id)}
                className="opacity-0 group-hover:opacity-100 p-1 text-text-sub hover:text-red-500 transition-opacity"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add New */}
      {isAdding ? (
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={newRequirement}
            onChange={(e) => setNewRequirement(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a requirement..."
            className="flex-1"
            autoFocus
          />
          <Button type="button" size="sm" onClick={handleAdd} disabled={!newRequirement.trim()}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAdding(false);
              setNewRequirement('');
            }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setIsAdding(true);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="w-full justify-start text-text-sub"
        >
          <Plus className="h-4 w-4 mr-2" />
          Add requirement
        </Button>
      )}

      {requirements.length === 0 && !isAdding && (
        <p className="text-sm text-text-sub italic">
          No template requirements. Tasks created from this SOP will start with an empty checklist.
        </p>
      )}
    </div>
  );
}
