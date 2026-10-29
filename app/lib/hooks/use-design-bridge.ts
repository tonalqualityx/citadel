'use client';

/**
 * Designer Portal: React wrapper for the preview postMessage bridge (lib/design/bridge.ts, design 9.2).
 *
 * Attaches one bridge per `previewUrl` (re-attaching with the new origin when it changes) and detaches on unmount.
 * Exposes select mode (posting `dp:select` to the overlay), the latest page path the frame reported, and the pin
 * drafts produced by `dp:packet`. It performs no network call: drafts become pins only when the tray POSTs them.
 */
import * as React from 'react';
import { createBridge, type Bridge, type PinDraft, type ReadyInfo } from '@/lib/design/bridge';

/** The tray holds at most 100 pins (MAX_PENDING_PINS); unsaved drafts are capped the same, oldest dropped. */
export const MAX_BRIDGE_DRAFTS = 100;

export interface BridgeDraft {
  /** Local id for list keys and removal; not a pin id. */
  id: string;
  draft: PinDraft;
  received_at: number;
}

export interface UseDesignBridgeOptions {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** `session.preview_url` (null while the preview is being set up). */
  previewUrl: string | null | undefined;
  onPacket?: (draft: PinDraft) => void;
  onNavigate?: (nav: { path: string }) => void;
  onReady?: (info: ReadyInfo) => void;
  onBlocked?: (info: { what: 'form' }) => void;
}

export interface UseDesignBridgeResult {
  selectMode: boolean;
  setSelectMode: (on: boolean) => void;
  /** True once the overlay on the current preview origin posted `dp:ready`. */
  ready: boolean;
  /** Path the frame last reported (dp:ready or dp:navigate), null before the first report. */
  path: string | null;
  drafts: BridgeDraft[];
  latestDraft: BridgeDraft | null;
  removeDraft: (id: string) => void;
  clearDrafts: () => void;
  highlight: (selector: string) => boolean;
  scroll: (selector: string) => boolean;
}

let draftSeq = 0;

export function useDesignBridge(options: UseDesignBridgeOptions): UseDesignBridgeResult {
  const { iframeRef, previewUrl } = options;
  const url = previewUrl ?? null;

  // Per-preview state is stored with the url it belongs to, so a preview change resets it without an effect.
  const [select, setSelect] = React.useState<{ url: string | null; on: boolean }>({ url: null, on: false });
  const [frame, setFrame] = React.useState<{ url: string | null; ready: boolean; path: string | null }>({
    url: null,
    ready: false,
    path: null,
  });
  const [drafts, setDrafts] = React.useState<BridgeDraft[]>([]);

  const selectMode = select.url === url && select.on;
  const bridgeRef = React.useRef<Bridge | null>(null);
  const selectRef = React.useRef(selectMode);
  const callbacks = React.useRef(options);
  React.useEffect(() => {
    callbacks.current = options;
    selectRef.current = selectMode;
  });

  React.useEffect(() => {
    const bridge = createBridge({
      previewUrl: url,
      getIframeWindow: () => iframeRef.current?.contentWindow ?? null,
      onPacket: (draft) => {
        draftSeq += 1;
        const item: BridgeDraft = { id: `draft-${draftSeq}`, draft, received_at: Date.now() };
        setDrafts((prev) => [...prev, item].slice(-MAX_BRIDGE_DRAFTS));
        callbacks.current.onPacket?.(draft);
      },
      onNavigate: (nav) => {
        setFrame((prev) => ({ url, ready: prev.url === url && prev.ready, path: nav.path }));
        callbacks.current.onNavigate?.(nav);
      },
      onReady: (info) => {
        setFrame({ url, ready: true, path: info.path });
        // Every page load starts the overlay with select mode off; restore what the designer has on.
        if (selectRef.current) bridge.send({ type: 'dp:select', on: true });
        callbacks.current.onReady?.(info);
      },
      onSelectChange: (on) => {
        setSelect({ url, on });
      },
      onBlocked: (info) => {
        callbacks.current.onBlocked?.(info);
      },
    });
    bridgeRef.current = bridge;
    bridge.attach();
    return () => {
      bridge.detach();
      if (bridgeRef.current === bridge) bridgeRef.current = null;
    };
  }, [url, iframeRef]);

  const setSelectMode = React.useCallback(
    (on: boolean) => {
      setSelect({ url, on });
      bridgeRef.current?.send({ type: 'dp:select', on });
    },
    [url],
  );

  const removeDraft = React.useCallback((id: string) => {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }, []);
  const clearDrafts = React.useCallback(() => setDrafts([]), []);
  const highlight = React.useCallback(
    (selector: string) => bridgeRef.current?.send({ type: 'dp:highlight', selector }) ?? false,
    [],
  );
  const scroll = React.useCallback(
    (selector: string) => bridgeRef.current?.send({ type: 'dp:scroll', selector }) ?? false,
    [],
  );

  const current = frame.url === url;
  return {
    selectMode,
    setSelectMode,
    ready: current && frame.ready,
    path: current ? frame.path : null,
    drafts,
    latestDraft: drafts.length ? drafts[drafts.length - 1] : null,
    removeDraft,
    clearDrafts,
    highlight,
    scroll,
  };
}
