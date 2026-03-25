'use client';

import * as React from 'react';
import { FileText, Plus, Trash2, Pencil, Check } from 'lucide-react';
import { useMsaVersions, useDeleteMsaVersion } from '@/lib/hooks/use-msa';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';

function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface MsaVersionListProps {
  onEdit: (id: string) => void;
  onCreate: () => void;
}

export function MsaVersionList({ onEdit, onCreate }: MsaVersionListProps) {
  const { data, isLoading } = useMsaVersions();
  const deleteMsa = useDeleteMsaVersion();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-text-main">MSA Versions</h3>
          <p className="text-sm text-text-sub">
            Manage Master Service Agreement versions.
          </p>
        </div>
        <Button size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4 mr-1" />
          New Version
        </Button>
      </div>

      {data?.msa_versions && data.msa_versions.length > 0 ? (
        <div className="space-y-3">
          {data.msa_versions.map((msa) => (
            <div
              key={msa.id}
              className="flex items-center justify-between py-3 px-4 rounded-lg border border-border-warm"
            >
              <div className="flex items-center gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-main">
                      Version {msa.version}
                    </span>
                    {msa.is_current && (
                      <Badge variant="success" size="sm">
                        <Check className="h-3 w-3 mr-0.5" />
                        Current
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-text-sub">
                    Effective {formatDate(msa.effective_date)}
                    {msa.created_by && ` · Created by ${msa.created_by.name}`}
                  </div>
                  {msa.change_summary && (
                    <div className="text-xs text-text-sub mt-0.5">
                      {msa.change_summary}
                    </div>
                  )}
                  {msa.signatures_count != null && msa.signatures_count > 0 && (
                    <div className="text-xs text-text-sub mt-0.5">
                      {msa.signatures_count} signature{msa.signatures_count !== 1 ? 's' : ''}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(msa.id)}
                  title="Edit version"
                >
                  <Pencil className="h-3.5 w-3.5 text-text-sub" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMsa.mutate(msa.id)}
                  disabled={deleteMsa.isPending}
                  title="Delete version"
                >
                  <Trash2 className="h-3.5 w-3.5 text-text-sub hover:text-red-500" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title="No MSA versions"
          description="Create your first Master Service Agreement version."
          className="py-8"
        />
      )}
    </div>
  );
}
