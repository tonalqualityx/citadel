'use client';

import * as React from 'react';
import { Key, Plus, Copy, Check, Loader2, Trash2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalDescription,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import { useApiKeys, useCreateApiKey, useRevokeApiKey } from '@/lib/hooks/use-api-keys';

export default function ApiKeysPage() {
  const { data, isLoading } = useApiKeys();
  const createKey = useCreateApiKey();
  const revokeKey = useRevokeApiKey();

  const [showCreate, setShowCreate] = React.useState(false);
  const [newKeyName, setNewKeyName] = React.useState('');
  const [createdKey, setCreatedKey] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [revokeId, setRevokeId] = React.useState<string | null>(null);

  const handleCreate = async () => {
    if (!newKeyName.trim()) return;

    const result = await createKey.mutateAsync({ name: newKeyName.trim() });
    setCreatedKey(result.key);
    setNewKeyName('');
  };

  const handleCopy = async () => {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCloseCreate = () => {
    setShowCreate(false);
    setCreatedKey(null);
    setNewKeyName('');
  };

  const handleRevoke = async () => {
    if (!revokeId) return;
    await revokeKey.mutateAsync(revokeId);
    setRevokeId(null);
  };

  const apiKeys = data?.api_keys ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1 text-sm text-text-sub hover:text-text-main mb-4"
      >
        <ArrowLeft className="h-4 w-4" />
        Settings
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-main flex items-center gap-2">
            <Key className="h-6 w-6" />
            API Keys
          </h1>
          <p className="mt-2 text-text-sub">
            Create API keys for external tools to access the Citadel API.
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Create Key
        </Button>
      </div>

      <div className="mt-6 space-y-3">
        {apiKeys.length === 0 ? (
          <div className="bg-surface rounded-lg border border-border-warm p-8 text-center">
            <Key className="h-10 w-10 mx-auto text-text-sub mb-3" />
            <p className="text-text-sub">No API keys yet.</p>
            <p className="text-sm text-text-sub mt-1">
              Create a key to allow external tools to access the API.
            </p>
          </div>
        ) : (
          apiKeys.map((key) => (
            <div
              key={key.id}
              className="bg-surface rounded-lg border border-border-warm p-4 flex items-center justify-between"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-main">{key.name}</span>
                  {key.expires_at && new Date(key.expires_at) < new Date() && (
                    <Badge variant="error">Expired</Badge>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-4 text-sm text-text-sub">
                  <span className="font-mono">{key.key_prefix}...</span>
                  <span>
                    Created {new Date(key.created_at).toLocaleDateString()}
                  </span>
                  {key.last_used_at && (
                    <span>
                      Last used {new Date(key.last_used_at).toLocaleDateString()}
                    </span>
                  )}
                  {key.expires_at && (
                    <span>
                      Expires {new Date(key.expires_at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setRevokeId(key.id)}
                className="text-red-500 hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>

      {/* Create Key Modal */}
      <Modal open={showCreate} onOpenChange={(open) => !open && handleCloseCreate()}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>{createdKey ? 'API Key Created' : 'Create API Key'}</ModalTitle>
            <ModalDescription>
              {createdKey
                ? 'Copy this key now. It will not be shown again.'
                : 'Give your key a descriptive name.'}
            </ModalDescription>
          </ModalHeader>
          <ModalBody>
            {createdKey ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <code className="flex-1 p-3 bg-surface-alt rounded text-sm font-mono break-all border border-border">
                    {createdKey}
                  </code>
                  <Button variant="secondary" size="sm" onClick={handleCopy}>
                    {copied ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                <p className="text-sm text-text-sub">
                  Use this key in the <code className="text-xs">Authorization</code> header:
                </p>
                <code className="block p-2 bg-surface-alt rounded text-xs font-mono border border-border">
                  Authorization: Bearer {createdKey.substring(0, 20)}...
                </code>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">
                  Key Name
                </label>
                <Input
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                  placeholder="e.g. Openclaw Production"
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                />
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            {createdKey ? (
              <Button onClick={handleCloseCreate}>Done</Button>
            ) : (
              <>
                <Button variant="secondary" onClick={handleCloseCreate}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreate}
                  disabled={!newKeyName.trim() || createKey.isPending}
                >
                  {createKey.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    'Create'
                  )}
                </Button>
              </>
            )}
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* Revoke Confirmation Modal */}
      <Modal open={!!revokeId} onOpenChange={(open) => !open && setRevokeId(null)}>
        <ModalContent size="sm">
          <ModalHeader>
            <ModalTitle>Revoke API Key</ModalTitle>
            <ModalDescription>
              This key will immediately stop working. Any external tools using it will lose access.
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button variant="secondary" onClick={() => setRevokeId(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRevoke}
              disabled={revokeKey.isPending}
            >
              {revokeKey.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                'Revoke Key'
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
