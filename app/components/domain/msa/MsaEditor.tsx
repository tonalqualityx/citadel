'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { RichTextEditor, type BlockNoteContent } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useCreateMsaVersion, useUpdateMsaVersion } from '@/lib/hooks/use-msa';
import type { MsaVersionWithRelations } from '@/types/entities';

const msaSchema = z.object({
  version: z.string().min(1, 'Version is required'),
  effective_date: z.string().min(1, 'Effective date is required'),
  is_current: z.boolean().optional(),
  change_summary: z.string().optional(),
});

type MsaFormData = z.infer<typeof msaSchema>;

interface MsaEditorProps {
  existing?: MsaVersionWithRelations | null;
  onClose: () => void;
}

export function MsaEditor({ existing, onClose }: MsaEditorProps) {
  const createMsa = useCreateMsaVersion();
  const updateMsa = useUpdateMsaVersion();
  const isEdit = !!existing;

  const [content, setContent] = React.useState<BlockNoteContent | null>(
    existing?.content ? JSON.parse(existing.content) : null
  );

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<MsaFormData>({
    resolver: zodResolver(msaSchema),
    defaultValues: {
      version: existing?.version || '',
      effective_date: existing?.effective_date?.split('T')[0] || '',
      is_current: existing?.is_current || false,
      change_summary: existing?.change_summary || '',
    },
  });

  const onSubmit = async (data: MsaFormData) => {
    const contentStr = content ? JSON.stringify(content) : '';

    if (isEdit && existing) {
      await updateMsa.mutateAsync({
        id: existing.id,
        data: {
          version: data.version,
          content: contentStr,
          effective_date: data.effective_date,
          is_current: data.is_current,
          change_summary: data.change_summary || undefined,
        },
      });
    } else {
      await createMsa.mutateAsync({
        version: data.version,
        content: contentStr,
        effective_date: data.effective_date,
        is_current: data.is_current,
        change_summary: data.change_summary || undefined,
      });
    }
    onClose();
  };

  const isPending = createMsa.isPending || updateMsa.isPending;

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-main">
          {isEdit ? 'Edit' : 'New'} MSA Version
        </h3>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Version"
          {...register('version')}
          error={errors.version?.message}
          placeholder="e.g. 2.0"
        />
        <Input
          label="Effective Date"
          type="date"
          {...register('effective_date')}
          error={errors.effective_date?.message}
        />
      </div>

      <Textarea
        label="Change Summary"
        {...register('change_summary')}
        placeholder="Brief description of changes from previous version..."
        rows={2}
      />

      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" {...register('is_current')} className="rounded" />
        <span className="text-sm text-text-main">Set as current active version</span>
      </label>

      {/* Rich Text Editor for MSA content */}
      <div>
        <label className="block text-sm font-medium text-text-main mb-1">
          MSA Content
        </label>
        <div className="rounded-lg border border-border-warm overflow-hidden">
          <RichTextEditor
            content={content}
            onChange={setContent}
            placeholder="Enter MSA terms and conditions..."
          />
        </div>
      </div>

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
