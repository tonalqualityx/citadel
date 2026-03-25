'use client';

import * as React from 'react';
import { FileText, ArrowLeft } from 'lucide-react';
import { MsaVersionList } from '@/components/domain/msa/MsaVersionList';
import { MsaEditor } from '@/components/domain/msa/MsaEditor';
import { useMsaVersion } from '@/lib/hooks/use-msa';
import { Button } from '@/components/ui/button';

export default function MsaPage() {
  const [mode, setMode] = React.useState<'list' | 'create' | 'edit'>('list');
  const [editingMsaId, setEditingMsaId] = React.useState<string | null>(null);
  const { data: editingMsa } = useMsaVersion(editingMsaId || '');

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-main flex items-center gap-2">
            <FileText className="h-6 w-6" />
            Master Service Agreement
          </h1>
          <p className="text-text-sub">
            Manage MSA versions that clients sign before work begins.
          </p>
        </div>
        {mode !== 'list' && (
          <Button
            variant="ghost"
            onClick={() => {
              setMode('list');
              setEditingMsaId(null);
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
          <MsaVersionList
            onEdit={(id) => {
              setEditingMsaId(id);
              setMode('edit');
            }}
            onCreate={() => setMode('create')}
          />
        )}
        {mode === 'create' && (
          <MsaEditor
            onClose={() => setMode('list')}
          />
        )}
        {mode === 'edit' && editingMsa && (
          <MsaEditor
            existing={editingMsa}
            onClose={() => {
              setMode('list');
              setEditingMsaId(null);
            }}
          />
        )}
      </div>
    </div>
  );
}
