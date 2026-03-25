'use client';

import * as React from 'react';
import { useForm, Controller } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RichTextEditor, type BlockNoteContent } from '@/components/ui/rich-text-editor';
import { useCreateAddendum, useUpdateAddendum } from '@/lib/hooks/use-addendums';
import type { AddendumWithRelations } from '@/types/entities';

const addendumSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  description: z.any(), // BlockNote content (JSON array)
  contract_content: z.any(), // BlockNote content (JSON array)
  changes: z.string().optional(),
  pricing_snapshot: z.string().optional(),
  is_override: z.boolean().optional(),
  override_reason: z.string().optional(),
});

type AddendumFormData = z.infer<typeof addendumSchema>;

interface AddendumFormProps {
  accordId: string;
  existing?: AddendumWithRelations;
  onClose: () => void;
}

/**
 * Attempt to parse stored content into BlockNote format.
 * Handles: JSON arrays (BlockNote), JSON objects (TipTap), plain strings.
 */
function parseStoredContent(raw: string | any): BlockNoteContent | null {
  if (!raw) return null;
  // Already an object/array (not string)
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    // Plain text - return null; RichTextEditor will handle gracefully
    return null;
  }
}

export function AddendumForm({ accordId, existing, onClose }: AddendumFormProps) {
  const createAddendum = useCreateAddendum();
  const updateAddendum = useUpdateAddendum();
  const isEdit = !!existing;

  // Rich text state managed outside react-hook-form since BlockNote is uncontrolled
  const [descriptionContent, setDescriptionContent] = React.useState<BlockNoteContent | null>(
    () => parseStoredContent(existing?.description)
  );
  const [contractContent, setContractContent] = React.useState<BlockNoteContent | null>(
    () => parseStoredContent(existing?.contract_content)
  );

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<AddendumFormData>({
    resolver: zodResolver(addendumSchema),
    defaultValues: {
      title: existing?.title || '',
      changes: existing?.changes ? JSON.stringify(existing.changes, null, 2) : '',
      pricing_snapshot: existing?.pricing_snapshot
        ? JSON.stringify(existing.pricing_snapshot, null, 2)
        : '',
      is_override: existing?.is_override || false,
      override_reason: existing?.override_reason || '',
    },
  });

  const isOverride = watch('is_override');

  const onSubmit = async (data: AddendumFormData) => {
    let parsedChanges: unknown = null;
    let parsedPricing: unknown = null;

    try {
      parsedChanges = data.changes ? JSON.parse(data.changes) : null;
    } catch {
      parsedChanges = data.changes || null;
    }

    try {
      parsedPricing = data.pricing_snapshot ? JSON.parse(data.pricing_snapshot) : null;
    } catch {
      parsedPricing = data.pricing_snapshot || null;
    }

    // Serialize rich text content to JSON string for storage
    const descriptionValue = descriptionContent ? JSON.stringify(descriptionContent) : '';
    const contractValue = contractContent ? JSON.stringify(contractContent) : '';

    const payload = {
      title: data.title,
      description: descriptionValue,
      contract_content: contractValue,
      changes: parsedChanges,
      pricing_snapshot: parsedPricing,
      is_override: data.is_override,
      override_reason: data.is_override ? data.override_reason || undefined : undefined,
    };

    if (isEdit && existing) {
      await updateAddendum.mutateAsync({
        accordId,
        addendumId: existing.id,
        data: {
          title: payload.title,
          description: payload.description,
          contract_content: payload.contract_content,
          changes: payload.changes,
          pricing_snapshot: payload.pricing_snapshot,
        },
      });
    } else {
      await createAddendum.mutateAsync({
        accordId,
        data: payload,
      });
    }
    onClose();
  };

  const isPending = createAddendum.isPending || updateAddendum.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-main">
          {isEdit ? 'Edit' : 'New'} Addendum
        </h3>
      </div>

      <Input
        label="Title"
        {...register('title')}
        error={errors.title?.message}
        placeholder="e.g. Add SEO services"
      />

      <div>
        <label className="block text-sm font-medium text-text-main mb-1.5">
          Description
        </label>
        <RichTextEditor
          content={descriptionContent}
          onChange={setDescriptionContent}
          placeholder="Brief description of the scope change..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-text-main mb-1.5">
          Contract Content
        </label>
        <RichTextEditor
          content={contractContent}
          onChange={setContractContent}
          placeholder="The addendum contract language..."
        />
      </div>

      <Textarea
        label="Changes (JSON)"
        {...register('changes')}
        placeholder='e.g. [{"type": "add", "item": "SEO audit", "price": 500}]'
        rows={4}
      />

      <Textarea
        label="Pricing Snapshot (JSON)"
        {...register('pricing_snapshot')}
        placeholder="Pricing data or leave empty to auto-populate from accord line items..."
        rows={4}
      />

      {/* Override */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" {...register('is_override')} className="rounded" />
        <span className="text-sm text-text-main">Override (skip client approval)</span>
      </label>

      {isOverride && (
        <Textarea
          label="Override Reason"
          {...register('override_reason')}
          placeholder="Explain why this addendum is being overridden..."
          rows={2}
        />
      )}

      <div className="flex justify-end gap-2 pt-2 border-t border-border-warm">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving...' : isEdit ? 'Update' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
