'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalDescription, ModalFooter } from '@/components/ui/modal';
import { useRestoreVersion } from '@/lib/hooks/use-design-tray';
import type { ChangeView } from './ChangesTab';

export interface VersionsTabProps {
  sessionId: string;
  changes: ChangeView[];
  /** The session's current head, marked as "Current". */
  headSha: string | null;
  baseSha?: string | null;
  disabled?: boolean;
}

const short = (sha: string) => sha.slice(0, 7);

export function VersionsTab({ sessionId, changes, headSha, baseSha, disabled }: VersionsTabProps) {
  const restore = useRestoreVersion(sessionId);
  const [target, setTarget] = React.useState<{ sha: string; label: string } | null>(null);

  const ordered = [...changes].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const isHead = (sha: string) => !!headSha && sha.toLowerCase() === headSha.toLowerCase();

  if (ordered.length === 0) return <p className="p-4 text-sm text-text-sub">No versions yet. Each change the worker records becomes a version.</p>;

  return (
    <div className="p-1">
      <ol className="flex flex-col gap-2" aria-label="Versions">
        {ordered.map((c) => (
          <li key={c.id} className="flex items-start gap-3 rounded-lg border border-border-warm bg-surface p-3" data-testid="version-row">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-main">{c.summary}</p>
              <p className="mt-0.5 text-xs text-text-sub">
                <code>{short(c.commit_sha)}</code> - {new Date(c.created_at).toLocaleString()}
                {c.is_restore && c.restored_from ? ` - restored from ${short(c.restored_from)}` : ''}
              </p>
            </div>
            {isHead(c.commit_sha) ? (
              <Badge variant="success">Current</Badge>
            ) : (
              <Button type="button" size="sm" variant="secondary" disabled={disabled || restore.isPending} onClick={() => setTarget({ sha: c.commit_sha, label: c.summary })}>
                Restore
              </Button>
            )}
          </li>
        ))}
        {baseSha && (
          <li className="flex items-start gap-3 rounded-lg border border-border-warm bg-surface p-3" data-testid="version-row">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-text-main">Starting point</p>
              <p className="mt-0.5 text-xs text-text-sub">
                <code>{short(baseSha)}</code>
              </p>
            </div>
            {isHead(baseSha) ? (
              <Badge variant="success">Current</Badge>
            ) : (
              <Button type="button" size="sm" variant="secondary" disabled={disabled || restore.isPending} onClick={() => setTarget({ sha: baseSha, label: 'the starting point' })}>
                Restore
              </Button>
            )}
          </li>
        )}
      </ol>

      <Modal open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Restore this version?</ModalTitle>
            <ModalDescription>
              The site goes back to {target ? `"${target.label}" (${short(target.sha)})` : ''} as a new version. Nothing is lost, and you can restore a later version afterwards.
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={restore.isPending}
              onClick={() => {
                if (!target) return;
                restore.mutate(target.sha, { onSuccess: () => setTarget(null) });
              }}
            >
              Restore
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
