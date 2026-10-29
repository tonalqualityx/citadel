'use client';

import * as React from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Modal, ModalBody, ModalContent, ModalDescription, ModalFooter, ModalHeader, ModalTitle } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/textarea';
import type { DesignFeedResponse } from '@/lib/hooks/use-design';
import { useRequestPublish } from '@/lib/hooks/use-design-publish';
import { PublishConfirmDialog } from './PublishConfirmDialog';

/** The publish.reason code (PolicyCode) that means an admin override switched designer publish off for this site. */
export const DESIGNER_PUBLISH_OFF = 'designer_publish_off';

const REASON_TEXT: Record<string, string> = {
  designer_publish_off: 'Publishing is switched off for this site. You can send a note to the owner instead.',
  session_required: 'Publishing needs a signed-in session.',
  forbidden: 'You cannot publish.',
  site_not_enabled: 'The design portal is not enabled for this site.',
  session_closed: 'This session is closed.',
  session_stopped: 'This session is stopped. Resume it before publishing.',
  publish_in_progress: 'A publish is already running.',
  stale_head: 'The worker is still working, or there is nothing to publish yet.',
  gates_not_green: 'The gates have not run green on this version yet.',
};

export function reasonText(reason: string | undefined): string {
  return (reason && REASON_TEXT[reason]) || 'Publishing is not available right now.';
}

export interface PublishButtonProps {
  sessionId: string;
  /** The latest feed response (useDesignFeedHistory's `latest`). Undefined until the first poll: the button waits. */
  feed: DesignFeedResponse | undefined;
}

function RequestPublish({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = React.useState(false);
  const [note, setNote] = React.useState('');
  const request = useRequestPublish(sessionId);
  return (
    <>
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Request publish
      </Button>
      <Modal open={open} onOpenChange={setOpen}>
        <ModalContent size="md">
          <ModalHeader>
            <ModalTitle>Request publish</ModalTitle>
            <ModalDescription>Publishing is switched off for this site. This sends a note to the owner so they know this version is ready. Nothing waits on it.</ModalDescription>
          </ModalHeader>
          <ModalBody>
            <Textarea label="Note to the owner (optional)" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} rows={4} />
          </ModalBody>
          <ModalFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              type="button"
              disabled={request.isPending}
              onClick={() => request.mutate(note, { onSuccess: () => { setOpen(false); setNote(''); } })}
            >
              {request.isPending ? 'Sending...' : 'Send note'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

/** Secondary "Publish to live..." beside the preview state. The server's can_publish and reason decide everything. */
export function PublishButton({ sessionId, feed }: PublishButtonProps) {
  const [open, setOpen] = React.useState(false);
  const pub = feed?.publish;

  if (pub && !pub.can_publish && pub.reason === DESIGNER_PUBLISH_OFF) return <RequestPublish sessionId={sessionId} />;

  const enabled = !!pub?.can_publish && !!feed?.head_sha;
  const why = !pub ? 'Loading...' : enabled ? undefined : reasonText(pub.reason);
  return (
    <>
      {pub?.running_publish_id && (
        <Link href={`/design/publishes/${pub.running_publish_id}`} className="text-xs text-primary underline underline-offset-2">
          View publish
        </Link>
      )}
      <span title={why} className="inline-flex">
        <Button type="button" variant="secondary" size="sm" disabled={!enabled} aria-describedby={why ? `publish-why-${sessionId}` : undefined} onClick={() => setOpen(true)}>
          Publish to live...
        </Button>
        {why && <span id={`publish-why-${sessionId}`} className="sr-only">{why}</span>}
      </span>
      {enabled && <PublishConfirmDialog sessionId={sessionId} headSha={feed?.head_sha ?? null} open={open} onOpenChange={setOpen} />}
    </>
  );
}
