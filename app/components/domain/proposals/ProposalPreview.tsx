'use client';

import * as React from 'react';
import { RichTextRenderer } from '@/components/ui/rich-text-editor';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useProposal } from '@/lib/hooks/use-proposals';
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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

interface ProposalPreviewProps {
  accordId: string;
  proposalId: string;
  onClose: () => void;
}

export function ProposalPreview({ accordId, proposalId, onClose }: ProposalPreviewProps) {
  const { data: proposal, isLoading } = useProposal(accordId, proposalId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!proposal) return null;

  const pricingItems = Array.isArray(proposal.pricing_snapshot) ? proposal.pricing_snapshot as any[] : [];
  const totalValue = pricingItems.reduce((sum: number, item: any) => sum + Number(item.total), 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-text-main">
            Proposal v{proposal.version}
          </h3>
          <Badge variant={STATUS_VARIANT[proposal.status]} size="sm">
            {proposal.status.replace('_', ' ')}
          </Badge>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>

      {/* Meta */}
      <div className="flex gap-4 text-sm text-text-sub">
        <span>Created {formatDate(proposal.created_at)}</span>
        {proposal.created_by && <span>by {proposal.created_by.name}</span>}
        {proposal.sent_at && <span>Sent {formatDate(proposal.sent_at)}</span>}
        {proposal.client_responded_at && (
          <span>Responded {formatDate(proposal.client_responded_at)}</span>
        )}
      </div>

      {/* Client note */}
      {proposal.client_note && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
          <div className="text-sm font-medium text-text-main mb-1">Client Note</div>
          <div className="text-sm text-text-sub">{proposal.client_note}</div>
        </div>
      )}

      {/* Pricing Table */}
      {pricingItems.length > 0 && (
        <div className="rounded-lg border border-border-warm overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-background-light">
                <th className="text-left py-2 px-3 font-medium text-text-sub">Item</th>
                <th className="text-right py-2 px-3 font-medium text-text-sub">Price</th>
                <th className="text-right py-2 px-3 font-medium text-text-sub">Qty</th>
                <th className="text-right py-2 px-3 font-medium text-text-sub">Total</th>
              </tr>
            </thead>
            <tbody>
              {pricingItems.map((item: any, i: number) => (
                <tr key={i} className="border-t border-border-warm">
                  <td className="py-2 px-3 text-text-main">
                    {item.name_override || item.ware_name}
                  </td>
                  <td className="py-2 px-3 text-right text-text-main">
                    {formatCurrency(Number(item.price))}
                  </td>
                  <td className="py-2 px-3 text-right text-text-sub">
                    {item.quantity}
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-text-main">
                    {formatCurrency(Number(item.total))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-warm bg-background-light">
                <td colSpan={3} className="py-2 px-3 text-right font-medium text-text-main">
                  Total
                </td>
                <td className="py-2 px-3 text-right font-bold text-text-main">
                  {formatCurrency(totalValue)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Proposal Content */}
      {proposal.content && (
        <div className="rounded-lg border border-border-warm p-4">
          <RichTextRenderer content={JSON.parse(proposal.content)} />
        </div>
      )}
    </div>
  );
}
