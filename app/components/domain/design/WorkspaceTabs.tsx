'use client';

import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Tray } from './Tray';
import { ChangesTab, type ChangeView } from './ChangesTab';
import { VersionsTab } from './VersionsTab';
import { ClientFilesTab } from './ClientFilesTab';
import { designKeys, type DesignSessionResponse, type DesignFeedResponse } from '@/lib/hooks/use-design';
import type { BridgeDraft } from '@/lib/hooks/use-design-bridge';
import type { ClientFileRef, TrayPin } from '@/lib/hooks/use-design-tray';

export interface WorkspaceTabsProps {
  sessionId: string;
  /** The session load (useDesignSession): pins and changes come from here. */
  data: DesignSessionResponse;
  /** The feed (useDesignFeed or the merged history from W6.4): status, shas and events. */
  feed: DesignFeedResponse | undefined;
  /** All feed events seen so far (the merged list), oldest first or any order. Defaults to feed.events. */
  events?: DesignFeedResponse['events'];
  /** From useDesignBridge. */
  bridge: Pick<{ drafts: BridgeDraft[]; removeDraft: (id: string) => void; highlight: (selector: string) => boolean }, 'drafts' | 'removeDraft' | 'highlight'>;
}

export type WorkspaceTabSlots = { tray: React.ReactNode; changes: React.ReactNode; versions: React.ReactNode; 'client-files': React.ReactNode };

/**
 * Builds the four tab bodies for Workspace's `slots` (tray, changes, versions, client-files). Holds the attached
 * client files (shared by the tray and the Client files tab) and refetches the session load when the feed shows a
 * change or follow-up the load has not seen.
 */
export function useWorkspaceTabSlots({ sessionId, data, feed, events, bridge }: WorkspaceTabsProps): WorkspaceTabSlots {
  const queryClient = useQueryClient();
  const [attached, setAttached] = React.useState<ClientFileRef[]>([]);
  const feedEvents = React.useMemo(() => events ?? feed?.events ?? [], [events, feed?.events]);
  const changes = data.changes as unknown as ChangeView[];

  const knownChangeIds = React.useMemo(() => new Set(changes.map((c) => c.id)), [changes]);
  const unseen = React.useMemo(() => {
    const ids = new Set<string>();
    for (const e of feedEvents) {
      if (e.kind !== 'change') continue;
      const id = (e.payload as { change_id?: unknown } | null)?.change_id;
      if (typeof id === 'string' && !knownChangeIds.has(id)) ids.add(id);
    }
    return [...ids].sort().join(',');
  }, [feedEvents, knownChangeIds]);

  React.useEffect(() => {
    if (unseen) queryClient.invalidateQueries({ queryKey: designKeys.session(sessionId) });
  }, [unseen, sessionId, queryClient]);

  const previewSha = feed ? feed.preview_sha : data.session.preview_sha;
  const headSha = feed ? feed.head_sha : data.session.head_sha;
  const closed = (feed?.status ?? data.session.status) === 'closed' || (feed?.status ?? data.session.status) === 'abandoned';

  return {
    tray: (
      <Tray
        sessionId={sessionId}
        pins={data.pins as unknown as TrayPin[]}
        previewSha={previewSha}
        drafts={bridge.drafts}
        onRemoveDraft={bridge.removeDraft}
        onHighlight={(selector) => bridge.highlight(selector)}
        attachedFiles={attached}
        onDetachFile={(id) => setAttached((a) => a.filter((f) => f.id !== id))}
        onApplied={() => setAttached([])}
        disabled={closed}
      />
    ),
    changes: <ChangesTab sessionId={sessionId} changes={changes} events={feedEvents} />,
    versions: <VersionsTab sessionId={sessionId} changes={changes} headSha={headSha} baseSha={data.session.base_sha} disabled={closed} />,
    'client-files': (
      <ClientFilesTab
        sessionId={sessionId}
        events={feedEvents}
        attached={attached}
        onAttach={(f) => setAttached((a) => (a.some((x) => x.id === f.id) ? a : [...a, f]))}
        onDetach={(id) => setAttached((a) => a.filter((f) => f.id !== id))}
        disabled={closed}
      />
    ),
  };
}

/** Same four bodies stacked, for a caller that renders its own tab chrome. Workspace normally uses the hook. */
export function WorkspaceTabs(props: WorkspaceTabsProps) {
  const slots = useWorkspaceTabSlots(props);
  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Tray">{slots.tray}</section>
      <section aria-label="Changes">{slots.changes}</section>
      <section aria-label="Versions">{slots.versions}</section>
      <section aria-label="Client files">{slots['client-files']}</section>
    </div>
  );
}
