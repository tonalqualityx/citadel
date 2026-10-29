'use client';

import * as React from 'react';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDesignBridge, type UseDesignBridgeResult } from '@/lib/hooks/use-design-bridge';
import { previewOriginOf } from '@/lib/design/bridge';
import type { DesignFeedResponse, DesignSessionResponse } from '@/lib/hooks/use-design';
import { PreviewPane } from './PreviewPane';
import { TimerPill } from './TimerPill';

export const STATUS_LABELS: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'error' | 'info' }> = {
  pending: { label: 'Setting up', variant: 'info' },
  active: { label: 'Working', variant: 'success' },
  awaiting_input: { label: 'Waiting on you', variant: 'warning' },
  paused_budget: { label: 'Paused: budget', variant: 'warning' },
  stopped: { label: 'Stopped', variant: 'default' },
  publishing: { label: 'Publishing', variant: 'info' },
  closed: { label: 'Closed', variant: 'default' },
  abandoned: { label: 'Abandoned', variant: 'default' },
};

export function StatusChip({ status }: { status: string }) {
  const s = STATUS_LABELS[status] ?? { label: status.replace(/_/g, ' '), variant: 'default' as const };
  return <Badge variant={s.variant} size="sm" data-testid="status-chip">{s.label}</Badge>;
}

export type PreviewState = 'building' | 'up_to_date' | 'out_of_date';

/** Building = no preview or no built sha yet. Out of date = the branch head moved past the built preview. */
export function previewState(p: { preview_url: string | null; preview_sha: string | null; head_sha: string | null }): PreviewState {
  if (!p.preview_url || !p.preview_sha) return 'building';
  if (p.head_sha && p.head_sha !== p.preview_sha) return 'out_of_date';
  return 'up_to_date';
}

export const WORKSPACE_TABS: ReadonlyArray<{ id: string; label: string; task: string }> = [
  { id: 'chat', label: 'Chat', task: 'W6.4' },
  { id: 'tasks', label: 'Tasks', task: 'Tasks' },
  { id: 'changes', label: 'Changes', task: 'W6.5' },
  { id: 'versions', label: 'Versions', task: 'W6.5' },
  { id: 'client-files', label: 'Client files', task: 'W6.5' },
];

/** Slots W6.4/W6.5/W6.6 fill. A slot not given renders the placeholder. */
export interface WorkspaceSlots {
  chat?: React.ReactNode;
  tasks?: React.ReactNode;
  changes?: React.ReactNode;
  versions?: React.ReactNode;
  'client-files'?: React.ReactNode;
  /** W6.6: replaces the disabled "Publish to live..." button. */
  publishButton?: React.ReactNode;
}

/** Called once per render inside Workspace with the one bridge instance, so tab slots can share its drafts. */
export type UseWorkspaceSlots = (ctx: { bridge: UseDesignBridgeResult; view: { path: string | null; width: number | null; previewSha: string | null } }) => WorkspaceSlots;
const useNoSlots: UseWorkspaceSlots = () => ({});

export interface WorkspaceProps {
  data: DesignSessionResponse;
  feed: DesignFeedResponse | undefined;
  slots?: WorkspaceSlots;
  /** A hook (stable identity) that builds more slots from the bridge; explicit `slots` win. */
  useSlots?: UseWorkspaceSlots;
}

export function Workspace({ data, feed, slots: givenSlots = {}, useSlots = useNoSlots }: WorkspaceProps) {
  const iframeRef = React.useRef<HTMLIFrameElement | null>(null);
  // The feed is fresher than the one-shot session load for these fields.
  const status = feed?.status ?? data.session.status;
  const previewUrl = feed?.preview_url ?? data.session.preview_url;
  const previewSha = feed ? feed.preview_sha : data.session.preview_sha;
  const headSha = feed ? feed.head_sha : data.session.head_sha;

  const bridge = useDesignBridge({ iframeRef, previewUrl });
  const [pageView, setPageView] = React.useState<{ path: string; width: number } | null>(null);
  const onViewChange = React.useCallback((v: { path: string; width: number }) => {
    setPageView((prev) => (prev && prev.path === v.path && prev.width === v.width ? prev : v));
  }, []);
  const view = { path: pageView?.path ?? null, width: pageView?.width ?? null, previewSha: previewSha ?? null };
  const slots: WorkspaceSlots = { ...useSlots({ bridge, view }), ...givenSlots };
  const state = previewState({ preview_url: previewUrl, preview_sha: previewSha, head_sha: headSha });
  const safeLink = previewOriginOf(previewUrl) ? previewUrl : null;

  return (
    <div className="flex w-full min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link href="/design" className="inline-flex min-h-[44px] items-center text-sm text-text-sub hover:text-text-main sm:min-h-0">
          Back
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-text-main">{data.task?.title ?? 'Session'}</h1>
          <p className="text-xs text-text-sub">{data.site.name}</p>
        </div>
        <StatusChip status={status} />
        <p className="text-sm text-text-main" data-testid="preview-state">
          {state === 'up_to_date' && 'Preview up to date'}
          {state === 'out_of_date' && 'Preview out of date'}
          {state === 'building' && 'Preview building...'}
          {safeLink && state !== 'building' && (
            <>
              {' '}
              <a href={safeLink} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2">
                Open preview
              </a>
            </>
          )}
        </p>
        <div className="ml-auto flex items-center gap-2">
          <TimerPill timer={feed?.timer} />
          {slots.publishButton ?? (
            <Button type="button" variant="secondary" size="sm" disabled title="Available soon">
              Publish to live...
            </Button>
          )}
        </div>
      </header>

      <div data-testid="workspace-grid" className="grid min-h-[70vh] gap-4 min-[1100px]:grid-cols-[minmax(0,1fr)_clamp(340px,28vw,400px)]">
        <section aria-label="Preview" className="min-w-0">
          <PreviewPane
            previewUrl={previewUrl}
            status={status}
            liveText={feed?.live.text ?? data.session.live_text}
            iframeRef={iframeRef}
            selectMode={bridge.selectMode}
            onSelectModeChange={bridge.setSelectMode}
            reportedPath={bridge.path}
            onViewChange={onViewChange}
          />
        </section>
        <aside aria-label="Session panels" className="min-w-0 rounded-lg border border-border-warm bg-surface p-3">
          <Tabs defaultValue="chat">
            <TabsList className="h-auto w-full flex-wrap justify-start">
              {WORKSPACE_TABS.map((t) => (
                <TabsTrigger key={t.id} value={t.id}>{t.label}</TabsTrigger>
              ))}
            </TabsList>
            {WORKSPACE_TABS.map((t) => (
              <TabsContent key={t.id} value={t.id}>
                {slots[t.id as keyof WorkspaceSlots] ?? (
                  <p className="p-4 text-sm text-text-sub">{t.label}: coming in {t.task}.</p>
                )}
              </TabsContent>
            ))}
          </Tabs>
        </aside>
      </div>
    </div>
  );
}
