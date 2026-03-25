'use client';

import * as React from 'react';
import { ArrowLeft, Save } from 'lucide-react';
import { useContract, useUpdateContract } from '@/lib/hooks/use-contracts';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { showToast } from '@/lib/hooks/use-toast';

interface ContractEditorProps {
  accordId: string;
  contractId: string;
  onClose: () => void;
}

export function ContractEditor({ accordId, contractId, onClose }: ContractEditorProps) {
  const { data: contract, isLoading } = useContract(accordId, contractId);
  const updateContract = useUpdateContract();
  const [content, setContent] = React.useState<any>(null);
  const [initialized, setInitialized] = React.useState(false);

  // Initialize content from contract data
  React.useEffect(() => {
    if (contract && !initialized) {
      try {
        const parsed = typeof contract.content === 'string'
          ? JSON.parse(contract.content)
          : contract.content;
        setContent(parsed);
      } catch {
        setContent(null);
      }
      setInitialized(true);
    }
  }, [contract, initialized]);

  const handleSave = async () => {
    if (!content) return;

    try {
      await updateContract.mutateAsync({
        accordId,
        contractId,
        data: {
          content: JSON.stringify(content),
        },
      });
    } catch {
      // Error is handled by the mutation's onError
    }
  };

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={onClose} className="gap-2">
          <ArrowLeft className="h-4 w-4" />
          Back to contracts
        </Button>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleSave}
            disabled={updateContract.isPending}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {updateContract.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      {/* Contract Info */}
      <div className="flex items-center gap-4 text-sm text-text-sub">
        <span>Version {contract.version}</span>
        <span className="text-xs px-2 py-0.5 rounded bg-surface-warm text-text-sub">Draft</span>
      </div>

      {/* Editor */}
      <Card>
        <CardHeader>
          <CardTitle>Contract Content</CardTitle>
        </CardHeader>
        <CardContent>
          {initialized ? (
            <RichTextEditor
              content={content}
              onChange={setContent}
            />
          ) : (
            <div className="flex items-center justify-center py-8">
              <Spinner size="sm" />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
