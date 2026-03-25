'use client';

import * as React from 'react';
import {
  FileText,
  Plus,
  Send,
  Trash2,
  Eye,
  Pencil,
} from 'lucide-react';
import {
  useProposals,
  useCreateProposal,
  useDeleteProposal,
  useSendProposal,
} from '@/lib/hooks/use-proposals';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import type { ProposalStatus } from '@/types/entities';

const STATUS_VARIANT: Record<ProposalStatus, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
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

interface ProposalVersionListProps {
  accordId: string;
  onEdit: (proposalId: string) => void;
  onPreview: (proposalId: string) => void;
}

export function ProposalVersionList({ accordId, onEdit, onPreview }: ProposalVersionListProps) {
  const { data: proposalsData, isLoading } = useProposals(accordId);
  const createProposal = useCreateProposal();
  const deleteProposal = useDeleteProposal();
  const sendProposal = useSendProposal();

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
        <CardTitle>Proposals</CardTitle>
        <Button
          size="sm"
          onClick={() => createProposal.mutate({ accordId })}
          disabled={createProposal.isPending}
        >
          <Plus className="h-4 w-4 mr-1" />
          {createProposal.isPending ? 'Creating...' : 'New Version'}
        </Button>
      </CardHeader>
      <CardContent>
        {proposalsData?.proposals && proposalsData.proposals.length > 0 ? (
          <div className="space-y-3">
            {proposalsData.proposals.map((proposal) => (
              <div
                key={proposal.id}
                className="flex items-center justify-between py-3 px-4 rounded-lg border border-border-warm"
              >
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm font-medium text-text-main">
                      Version {proposal.version}
                    </div>
                    <div className="text-xs text-text-sub">
                      {formatDate(proposal.created_at)}
                      {proposal.created_by && ` by ${proposal.created_by.name}`}
                    </div>
                    {proposal.sent_at && (
                      <div className="text-xs text-text-sub">
                        Sent {formatDate(proposal.sent_at)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={STATUS_VARIANT[proposal.status]}
                    size="sm"
                  >
                    {proposal.status.replace('_', ' ')}
                  </Badge>
                  {proposal.client_note && (
                    <span
                      className="text-xs text-text-sub cursor-help"
                      title={proposal.client_note}
                    >
                      Note
                    </span>
                  )}
                  {/* View/Edit button */}
                  {proposal.status === 'draft' ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(proposal.id)}
                      title="Edit proposal"
                    >
                      <Pencil className="h-3.5 w-3.5 text-text-sub" />
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onPreview(proposal.id)}
                      title="View proposal"
                    >
                      <Eye className="h-3.5 w-3.5 text-text-sub" />
                    </Button>
                  )}
                  {proposal.status === 'draft' && (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          sendProposal.mutate({
                            accordId,
                            proposalId: proposal.id,
                          })
                        }
                        disabled={sendProposal.isPending}
                        title="Send to client"
                      >
                        <Send className="h-3.5 w-3.5 text-primary" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          deleteProposal.mutate({
                            accordId,
                            proposalId: proposal.id,
                          })
                        }
                        disabled={deleteProposal.isPending}
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
            title="No proposals yet"
            description="Create a proposal to send to the client."
            className="py-8"
          />
        )}
      </CardContent>
    </Card>
  );
}
