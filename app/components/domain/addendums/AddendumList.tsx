'use client';

import * as React from 'react';
import {
  FileText,
  Plus,
  Send,
  Trash2,
  Pencil,
} from 'lucide-react';
import {
  useAddendums,
  useSendAddendum,
  useDeleteAddendum,
} from '@/lib/hooks/use-addendums';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import type { AddendumStatus } from '@/types/entities';

const STATUS_VARIANT: Record<AddendumStatus, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  draft: 'default',
  sent: 'info',
  accepted: 'success',
  rejected: 'error',
  changes_requested: 'warning',
};

function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface AddendumListProps {
  accordId: string;
  onEdit: (id: string) => void;
  onCreate: () => void;
}

export function AddendumList({ accordId, onEdit, onCreate }: AddendumListProps) {
  const { data, isLoading } = useAddendums(accordId);
  const sendAddendum = useSendAddendum();
  const deleteAddendum = useDeleteAddendum();

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
        <CardTitle>Addendums</CardTitle>
        <Button size="sm" onClick={onCreate}>
          <Plus className="h-4 w-4 mr-1" />
          New Addendum
        </Button>
      </CardHeader>
      <CardContent>
        {data?.addendums && data.addendums.length > 0 ? (
          <div className="space-y-3">
            {data.addendums.map((addendum) => (
              <div
                key={addendum.id}
                className="flex items-center justify-between py-3 px-4 rounded-lg border border-border-warm"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-text-main">
                      v{addendum.version} &mdash; {addendum.title}
                    </div>
                    <div className="text-xs text-text-sub">
                      {formatDate(addendum.created_at)}
                      {addendum.created_by && ` by ${addendum.created_by.name}`}
                    </div>
                    {addendum.sent_at && (
                      <div className="text-xs text-text-sub">
                        Sent {formatDate(addendum.sent_at)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={STATUS_VARIANT[addendum.status]}
                    size="sm"
                  >
                    {addendum.status.replace('_', ' ')}
                  </Badge>
                  {addendum.is_override && (
                    <Badge variant="warning" size="sm">
                      override
                    </Badge>
                  )}
                  {addendum.client_note && (
                    <span
                      className="text-xs text-text-sub cursor-help"
                      title={addendum.client_note}
                    >
                      Note
                    </span>
                  )}

                  {/* Edit (draft only) */}
                  {addendum.status === 'draft' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onEdit(addendum.id)}
                        title="Edit addendum"
                      >
                        <Pencil className="h-3.5 w-3.5 text-text-sub" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          sendAddendum.mutate({
                            accordId,
                            addendumId: addendum.id,
                          })
                        }
                        disabled={sendAddendum.isPending}
                        title="Send to client"
                      >
                        <Send className="h-3.5 w-3.5 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          deleteAddendum.mutate({
                            accordId,
                            addendumId: addendum.id,
                          })
                        }
                        disabled={deleteAddendum.isPending}
                        title="Delete addendum"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-text-sub hover:text-red-500" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="No addendums yet"
            description="Create an addendum to modify the scope of this accord."
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}
