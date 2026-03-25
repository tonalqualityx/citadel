'use client';

import * as React from 'react';
import { RichTextEditor, type BlockNoteContent } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { useProposal, useUpdateProposal } from '@/lib/hooks/use-proposals';

interface ProposalEditorProps {
  accordId: string;
  proposalId: string;
  onClose: () => void;
}

export function ProposalEditor({ accordId, proposalId, onClose }: ProposalEditorProps) {
  const { data: proposal, isLoading } = useProposal(accordId, proposalId);
  const updateProposal = useUpdateProposal();
  const [content, setContent] = React.useState<BlockNoteContent | null>(null);
  const [initialized, setInitialized] = React.useState(false);

  // Initialize content from proposal data
  React.useEffect(() => {
    if (proposal && !initialized) {
      setContent(proposal.content ? JSON.parse(proposal.content) : null);
      setInitialized(true);
    }
  }, [proposal, initialized]);

  const handleSave = async () => {
    await updateProposal.mutateAsync({
      accordId,
      proposalId,
      data: {
        content: content ? JSON.stringify(content) : '',
      },
    });
    onClose();
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!proposal) return null;

  const isDraft = proposal.status === 'draft';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text-main">
          {isDraft ? 'Edit' : 'View'} Proposal v{proposal.version}
        </h3>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          {isDraft && (
            <Button
              size="sm"
              onClick={handleSave}
              disabled={updateProposal.isPending}
            >
              {updateProposal.isPending ? 'Saving...' : 'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Pricing Snapshot */}
      {proposal.pricing_snapshot && Array.isArray(proposal.pricing_snapshot) && proposal.pricing_snapshot.length > 0 && (
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
              {(proposal.pricing_snapshot as any[]).map((item: any, i: number) => (
                <tr key={i} className="border-t border-border-warm">
                  <td className="py-2 px-3 text-text-main">
                    {item.name_override || item.ware_name}
                  </td>
                  <td className="py-2 px-3 text-right text-text-main">
                    ${Number(item.price).toLocaleString()}
                  </td>
                  <td className="py-2 px-3 text-right text-text-sub">
                    {item.quantity}
                  </td>
                  <td className="py-2 px-3 text-right font-medium text-text-main">
                    ${Number(item.total).toLocaleString()}
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
                  ${(proposal.pricing_snapshot as any[]).reduce((sum: number, item: any) => sum + Number(item.total), 0).toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Rich Text Editor */}
      <div className="rounded-lg border border-border-warm overflow-hidden">
        <RichTextEditor
          content={content}
          onChange={setContent}
          readOnly={!isDraft}
          placeholder="Write your proposal content here..."
        />
      </div>
    </div>
  );
}
