'use client';

import * as React from 'react';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useContract } from '@/lib/hooks/use-contracts';
import { RichTextRenderer } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';

function formatCurrency(value: number | null): string {
  if (value == null) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

interface ContractViewerProps {
  accordId: string;
  contractId: string;
  onClose: () => void;
}

export function ContractViewer({ accordId, contractId, onClose }: ContractViewerProps) {
  const { data: contract, isLoading } = useContract(accordId, contractId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="text-center py-12 text-text-secondary">
        <p>Contract not found.</p>
      </div>
    );
  }

  // Parse content - could be JSON (BlockNote) or string
  let parsedContent: any = null;
  try {
    parsedContent = typeof contract.content === 'string' ? JSON.parse(contract.content) : contract.content;
  } catch {
    // If parsing fails, content is plain text
    parsedContent = null;
  }

  // Parse pricing snapshot
  let pricingItems: any[] = [];
  try {
    if (contract.pricing_snapshot) {
      pricingItems = typeof contract.pricing_snapshot === 'string'
        ? JSON.parse(contract.pricing_snapshot)
        : contract.pricing_snapshot;
      if (!Array.isArray(pricingItems)) pricingItems = [];
    }
  } catch {
    pricingItems = [];
  }

  const portalUrl = contract.portal_token
    ? `/portal/contract/${contract.portal_token}`
    : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to contracts
        </Button>
        <div className="flex items-center gap-2">
          {portalUrl && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => window.open(portalUrl, '_blank')}
              className="gap-2"
            >
              <ExternalLink className="h-4 w-4" />
              Preview as Client
            </Button>
          )}
          <Badge
            variant={
              contract.status === 'signed'
                ? 'success'
                : contract.status === 'sent'
                  ? 'info'
                  : 'default'
            }
          >
            {contract.status}
          </Badge>
        </div>
      </div>

      {/* Contract Info */}
      <div className="flex items-center gap-4 text-sm text-text-sub">
        <span>Version {contract.version}</span>
        {contract.msa_version && (
          <span>MSA {contract.msa_version.version}</span>
        )}
      </div>

      {/* Contract Content */}
      <Card>
        <CardHeader>
          <CardTitle>Contract Content</CardTitle>
        </CardHeader>
        <CardContent>
          {parsedContent ? (
            <RichTextRenderer content={parsedContent} />
          ) : (
            <div className="prose prose-sm max-w-none text-text-main whitespace-pre-wrap">
              {contract.content}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pricing Table */}
      {pricingItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pricing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-warm">
                    <th className="text-left py-2 px-3 font-medium text-text-sub">Item</th>
                    <th className="text-right py-2 px-3 font-medium text-text-sub">Price</th>
                    <th className="text-right py-2 px-3 font-medium text-text-sub">Qty</th>
                    <th className="text-right py-2 px-3 font-medium text-text-sub">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {pricingItems.map((item: any, index: number) => (
                    <tr key={index} className="border-b border-border-warm last:border-0">
                      <td className="py-2 px-3 text-text-main">
                        {item.name || item.name_override || '-'}
                      </td>
                      <td className="py-2 px-3 text-right text-text-main">
                        {formatCurrency(item.price)}
                      </td>
                      <td className="py-2 px-3 text-right text-text-sub">
                        {item.quantity || 1}
                      </td>
                      <td className="py-2 px-3 text-right font-medium text-text-main">
                        {formatCurrency((item.price || 0) * (item.quantity || 1))}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-border-warm">
                    <td colSpan={3} className="py-2 px-3 text-right font-medium text-text-main">
                      Total
                    </td>
                    <td className="py-2 px-3 text-right font-bold text-text-main">
                      {formatCurrency(
                        pricingItems.reduce(
                          (sum: number, item: any) => sum + (item.price || 0) * (item.quantity || 1),
                          0
                        )
                      )}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
