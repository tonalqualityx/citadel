'use client';

import * as React from 'react';
import { use } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  FileText,
  Zap,
  HelpCircle,
  Battery,
  CheckCircle,
  Settings,
  ClipboardCheck,
  ChevronDown,
  Plus,
  X,
  Clock,
  Flag,
} from 'lucide-react';
import { useSop, useUpdateSop } from '@/lib/hooks/use-sops';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Tooltip } from '@/components/ui/tooltip';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { InlineFunctionSelect } from '@/components/ui/function-select';
import { SectionedRequirementsEditor, type RequirementEntry } from '@/components/ui/sectioned-requirements-editor';
import {
  StatusInlineSelect,
  PriorityInlineSelect,
  EnergyInlineSelect,
  MysteryInlineSelect,
  BatteryInlineSelect,
  calculateTimeRange,
} from '@/components/ui/field-selects';

// ============================================
// INLINE EDITABLE COMPONENTS (generic ones still needed)
// ============================================

interface InlineSelectProps<T> {
  value: T;
  options: { value: T; label: string; variant?: 'default' | 'warning' | 'success'; color?: string; bg?: string }[];
  onChange: (value: T) => void;
  displayValue?: string;
  badge?: boolean;
  badgeVariant?: 'default' | 'warning' | 'success';
}

function InlineSelect<T extends string | number | boolean | null>({
  value,
  options,
  onChange,
  displayValue,
  badge = false,
  badgeVariant = 'default',
}: InlineSelectProps<T>) {
  const [isOpen, setIsOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentOption = options.find((o) => o.value === value);
  const display = displayValue || currentOption?.label || 'Select...';
  const displayColor = currentOption?.color || 'text-text-main';
  const displayBg = currentOption?.bg || '';

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1 hover:opacity-80 transition-opacity text-left"
      >
        {badge ? (
          <Badge variant={badgeVariant}>{display}</Badge>
        ) : (
          <span className={`text-sm font-medium px-2.5 py-0.5 rounded-full ${displayColor} ${displayBg}`}>
            {display}
          </span>
        )}
        <ChevronDown className="h-3 w-3 text-text-sub" />
      </button>
      {isOpen && (
        <div className="absolute z-50 mt-1 w-48 bg-surface border border-border rounded-lg shadow-lg py-2 px-2 space-y-1">
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => {
                onChange(option.value);
                setIsOpen(false);
              }}
              className={`w-full text-left px-2.5 py-1 text-sm rounded-full transition-opacity hover:opacity-80 ${
                option.value === value ? 'ring-2 ring-primary ring-offset-1' : ''
              } ${option.color || ''} ${option.bg || 'bg-surface-alt'}`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface InlineTextProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
}

function InlineText({ value, onChange, className = '', placeholder = 'Click to edit...' }: InlineTextProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (draft.trim()) {
      onChange(draft.trim());
    } else {
      setDraft(value);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSave();
    if (e.key === 'Escape') {
      setDraft(value);
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={handleSave}
        onKeyDown={handleKeyDown}
        className={`bg-transparent border-b-2 border-primary outline-none ${className}`}
      />
    );
  }

  return (
    <span
      onClick={() => {
        setDraft(value);
        setIsEditing(true);
      }}
      className={`cursor-pointer hover:bg-surface-alt px-1 -mx-1 rounded transition-colors ${className}`}
    >
      {value || <span className="text-text-sub italic">{placeholder}</span>}
    </span>
  );
}

// ============================================
// REQUIREMENTS EDITOR (INLINE)
// ============================================

interface Requirement {
  id: string;
  text: string;
  sort_order: number;
}

interface RequirementsEditorProps {
  requirements: Requirement[];
  onChange: (requirements: Requirement[]) => void;
  emptyMessage?: string;
}

function RequirementsEditor({ requirements, onChange, emptyMessage = 'No requirements' }: RequirementsEditorProps) {
  // Local state to show optimistic updates while saving
  const [localRequirements, setLocalRequirements] = React.useState(requirements);
  const [newText, setNewText] = React.useState('');
  const [isAdding, setIsAdding] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Sync local state when server data changes
  React.useEffect(() => {
    setLocalRequirements(requirements);
  }, [requirements]);

  const handleAdd = () => {
    if (!newText.trim()) return;
    const newReq: Requirement = {
      id: crypto.randomUUID(),
      text: newText.trim(),
      sort_order: localRequirements.length,
    };
    const updated = [...localRequirements, newReq];
    setLocalRequirements(updated); // Optimistic update
    onChange(updated); // Trigger save
    setNewText('');
  };

  const handleRemove = (id: string) => {
    const updated = localRequirements.filter((r) => r.id !== id);
    setLocalRequirements(updated);
    onChange(updated);
  };

  const handleUpdateText = (id: string, text: string) => {
    const updated = localRequirements.map((r) => (r.id === id ? { ...r, text } : r));
    setLocalRequirements(updated);
    onChange(updated);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
    if (e.key === 'Escape') {
      setIsAdding(false);
      setNewText('');
    }
  };

  return (
    <div className="space-y-2">
      {localRequirements.length === 0 && !isAdding && (
        <p className="text-sm text-text-sub italic">{emptyMessage}</p>
      )}
      {localRequirements
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((req, index) => (
          <div
            key={req.id}
            className="flex items-center gap-2 p-2 rounded-lg border border-border group"
          >
            <span className="text-sm text-text-sub w-5">{index + 1}.</span>
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
      {isAdding ? (
        <div className="flex items-center gap-2">
          <Input
            ref={inputRef}
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Add a requirement..."
            className="flex-1"
            autoFocus
          />
          <Button type="button" size="sm" onClick={handleAdd} disabled={!newText.trim()}>
            Add
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAdding(false);
              setNewText('');
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
    </div>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

interface Props {
  params: Promise<{ id: string }>;
}

export default function SopDetailPage({ params }: Props) {
  const { id } = use(params);
  const { t } = useTerminology();
  const { isPmOrAdmin } = useAuth();
  const { data, isLoading, error } = useSop(id);
  const updateSop = useUpdateSop(id);
  const sop = data?.sop;

  // Debounced save for content changes
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const save = React.useCallback(
    (updates: Record<string, unknown>) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        updateSop.mutate(updates as any);
      }, 500);
    },
    [updateSop]
  );

  // Immediate save for discrete changes
  const saveImmediate = React.useCallback(
    (updates: Record<string, unknown>) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      updateSop.mutate(updates as any);
    },
    [updateSop]
  );


  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !sop) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="py-8">
            <EmptyState
              icon={<FileText className="h-12 w-12" />}
              title={`${t('sop')} not found`}
              action={
                <Link href="/sops">
                  <Button>Back to {t('sops')}</Button>
                </Link>
              }
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const templateRequirements = (sop.template_requirements as RequirementEntry[] | null) || [];
  const setupRequirements = (sop.setup_requirements as Requirement[] | null) || [];
  const reviewRequirements = (sop.review_requirements as Requirement[] | null) || [];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/sops">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
        </Link>
        {updateSop.isPending && (
          <span className="text-sm text-text-sub flex items-center gap-2">
            <Spinner size="sm" />
            Saving...
          </span>
        )}
      </div>

      {/* Title & Status */}
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-3">
            <FileText className="h-6 w-6" />
            <InlineText
              value={sop.title}
              onChange={(title) => saveImmediate({ title })}
              className="text-2xl font-semibold"
            />
          </h1>
          <div className="flex items-center gap-3 mt-2">
            <StatusInlineSelect
              value={sop.is_active}
              onChange={(is_active) => saveImmediate({ is_active })}
            />
            <InlineFunctionSelect
              value={sop.function?.id || null}
              onChange={(function_id) => saveImmediate({ function_id })}
              displayValue={sop.function?.name}
              placeholder="No function"
            />
          </div>
        </div>
      </div>

      {/* Task Template Defaults */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Default Priority">
                <div className="p-2 rounded-lg bg-red-500/10 cursor-help">
                  <Flag className="h-5 w-5 text-red-500" />
                </div>
              </Tooltip>
              <PriorityInlineSelect
                value={sop.default_priority || 3}
                onChange={(default_priority) => saveImmediate({ default_priority })}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Energy Estimate">
                <div className="p-2 rounded-lg bg-blue-500/10 cursor-help">
                  <Zap className="h-5 w-5 text-blue-500" />
                </div>
              </Tooltip>
              <EnergyInlineSelect
                value={sop.energy_estimate}
                onChange={(energy_estimate) => saveImmediate({ energy_estimate })}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Mystery Factor">
                <div className="p-2 rounded-lg bg-purple-500/10 cursor-help">
                  <HelpCircle className="h-5 w-5 text-purple-500" />
                </div>
              </Tooltip>
              <MysteryInlineSelect
                value={sop.mystery_factor || 'none'}
                onChange={(mystery_factor) => saveImmediate({ mystery_factor })}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Battery Impact">
                <div className="p-2 rounded-lg bg-orange-500/10 cursor-help">
                  <Battery className="h-5 w-5 text-orange-500" />
                </div>
              </Tooltip>
              <BatteryInlineSelect
                value={sop.battery_impact || 'average_drain'}
                onChange={(battery_impact) => saveImmediate({ battery_impact })}
              />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center gap-3">
              <Tooltip content="Time Estimate">
                <div className="p-2 rounded-lg bg-primary/10 cursor-help">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </Tooltip>
              <div className="text-xl font-semibold text-text-main">
                {calculateTimeRange(sop.energy_estimate, sop.mystery_factor || 'none', sop.battery_impact || 'average_drain') || '-'}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instructions/Content */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Instructions</CardTitle>
          <p className="text-sm text-text-sub">
            Step-by-step instructions for completing tasks using this {t('sop')}
          </p>
        </CardHeader>
        <CardContent>
          <RichTextEditor
            content={sop.content}
            onChange={(content) => save({ content })}
            placeholder="Write your SOP instructions here..."
          />
        </CardContent>
      </Card>

      {/* PM/Admin Checklists - Setup & Review */}
      {isPmOrAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Setup Checklist */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge variant="warning">PM/Admin</Badge>
              </div>
              <CardTitle className="text-lg flex items-center gap-2">
                <Settings className="h-5 w-5" />
                Setup
              </CardTitle>
              <p className="text-sm text-text-sub">
                Task prep checklist - not visible to technicians
              </p>
            </CardHeader>
            <CardContent>
              <RequirementsEditor
                requirements={setupRequirements}
                onChange={(setup_requirements) =>
                  save({ setup_requirements: setup_requirements.length > 0 ? setup_requirements : null })
                }
                emptyMessage="No setup requirements."
              />
            </CardContent>
          </Card>

          {/* Review Checklist */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Badge variant="warning">PM/Admin</Badge>
              </div>
              <CardTitle className="text-lg flex items-center gap-2">
                <ClipboardCheck className="h-5 w-5" />
                Review
              </CardTitle>
              <p className="text-sm text-text-sub">
                Task review checklist - not visible to technicians
              </p>
            </CardHeader>
            <CardContent>
              <RequirementsEditor
                requirements={reviewRequirements}
                onChange={(review_requirements) =>
                  save({ review_requirements: review_requirements.length > 0 ? review_requirements : null })
                }
                emptyMessage="No review requirements."
              />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Task Requirements - Always visible */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CheckCircle className="h-5 w-5" />
            Task Requirements
          </CardTitle>
          <p className="text-sm text-text-sub">
            Checklist items copied to tasks created from this {t('sop')}
          </p>
        </CardHeader>
        <CardContent>
          <SectionedRequirementsEditor
            requirements={templateRequirements}
            onChange={(template_requirements) =>
              save({ template_requirements: template_requirements.length > 0 ? template_requirements : null })
            }
            emptyMessage="No task requirements. Add items or sections below."
          />
        </CardContent>
      </Card>
    </div>
  );
}
