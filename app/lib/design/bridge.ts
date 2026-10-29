/**
 * Designer Portal: the postMessage bridge between the Citadel workspace and the framed design preview
 * (design 9.2 as shipped in W3.3, D7, threats T12/T19). Browser-only; no React.
 *
 * Security boundary, in order, for every inbound `message` event:
 *   1. the bridge is attached and the preview origin resolved to a real http(s) origin (never "null");
 *   2. `event.origin === new URL(previewUrl).origin`;
 *   3. `event.source === getIframeWindow()`, and that window is not null (a null source must never match);
 *   4. the payload is a plain object under 16 KB with a string `type`;
 *   5. the type is one of the five inbound types the shipped overlay posts, and the payload passes its zod
 *      schema with the caps of D7 (oversize strings and arrays are rejected, never truncated).
 * Anything else is dropped silently and only counted in `stats()`.
 *
 * The bridge never performs a fetch, an XHR, a navigation or any mutation. Its only outputs are the callbacks.
 * A `dp:packet` becomes a `PinDraft` shaped exactly like the body of POST /api/design/sessions/:id/pins; turning a
 * draft into a pin is the designer's own later click (the tray), never this module.
 *
 * Outbound, `send()` posts only the three parent -> overlay types (`dp:select`, `dp:highlight`, `dp:scroll`), only
 * to the iframe's window, and only with the preview origin as `targetOrigin` (never "*").
 */
import { z } from 'zod';

/** Caps as shipped by the overlay (design-overlay.js) and accepted by the pins route (lib/design/pins.ts). */
export const BRIDGE_CAPS = {
  /** Every overlay message is "well under 16 KB" (overlay header comment, design 9.2). */
  messageChars: 16 * 1024,
  typeChars: 40,
  path: 500,
  sha: 64,
  dataLib: 100,
  libStack: 8,
  dataShape: 60,
  selector: 500,
  tag: 40,
  classes: 20,
  classChars: 60,
  textQuote: 200,
  viewport: 10000,
} as const;

// ---------------------------------------------------------------------------------------------------------
// Schemas (inbound: overlay -> parent)
// ---------------------------------------------------------------------------------------------------------

const finite = z.number().refine((n) => Number.isFinite(n), 'must be finite');
const pathSchema = z
  .string()
  .min(1)
  .max(BRIDGE_CAPS.path)
  .regex(/^\/(?!\/)\S*$/, 'path must start with a single /');
const shaSchema = z.string().min(1).max(BRIDGE_CAPS.sha);
const libId = z.string().regex(new RegExp(`^[a-z0-9_-]{1,${BRIDGE_CAPS.dataLib}}$`));
const viewportSchema = z.object({
  w: z.number().int().min(1).max(BRIDGE_CAPS.viewport),
  h: z.number().int().min(1).max(BRIDGE_CAPS.viewport),
});
const bboxSchema = z.object({ x: finite, y: finite, w: finite.min(0), h: finite.min(0) });

export const readyMessageSchema = z.object({
  type: z.literal('dp:ready'),
  path: pathSchema,
  sha: shaSchema,
  viewport: viewportSchema,
});

export const navigateMessageSchema = z.object({
  type: z.literal('dp:navigate'),
  path: pathSchema,
});

/** The overlay only ever posts `{on:false}` (Esc). A frame can never switch select mode ON in the parent. */
export const selectFromOverlaySchema = z.object({
  type: z.literal('dp:select'),
  on: z.literal(false),
});

export const blockedMessageSchema = z.object({
  type: z.literal('dp:blocked'),
  what: z.literal('form'),
});

/** `dp:packet` exactly as design-overlay.js builds it. No top-level width: the pin width is `viewport.w`. */
export const packetMessageSchema = z.object({
  type: z.literal('dp:packet'),
  path: pathSchema,
  sha: shaSchema,
  data_lib: libId,
  lib_stack: z.array(libId).max(BRIDGE_CAPS.libStack),
  data_shape: z.string().max(BRIDGE_CAPS.dataShape),
  selector: z.string().min(1).max(BRIDGE_CAPS.selector),
  tag: z.string().min(1).max(BRIDGE_CAPS.tag),
  classes: z.array(z.string().max(BRIDGE_CAPS.classChars)).max(BRIDGE_CAPS.classes),
  text_quote: z.string().max(BRIDGE_CAPS.textQuote),
  bbox: bboxSchema,
  viewport: viewportSchema,
});

const INBOUND_SCHEMAS = {
  'dp:ready': readyMessageSchema,
  'dp:navigate': navigateMessageSchema,
  'dp:packet': packetMessageSchema,
  'dp:select': selectFromOverlaySchema,
  'dp:blocked': blockedMessageSchema,
} as const;
type InboundType = keyof typeof INBOUND_SCHEMAS;

// ---------------------------------------------------------------------------------------------------------
// Schemas (outbound: parent -> overlay)
// ---------------------------------------------------------------------------------------------------------

const outboundSelector = z.string().min(1).max(BRIDGE_CAPS.selector);
export const outboundMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('dp:select'), on: z.boolean() }).strict(),
  z.object({ type: z.literal('dp:highlight'), selector: outboundSelector }).strict(),
  z.object({ type: z.literal('dp:scroll'), selector: outboundSelector }).strict(),
]);
export type OutboundMessage = z.infer<typeof outboundMessageSchema>;

// ---------------------------------------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------------------------------------

/**
 * A pin not yet saved: exactly the body POST /api/design/sessions/:id/pins accepts (`pinBodySchema`), minus the
 * optional `type` and `note` (the tray adds the note). `sha` is the preview build the packet came from, kept so the
 * tray can flag a stale pin. The pin width is `viewport.w` (see `pinDraftWidth`).
 */
export interface PinDraft {
  path: string;
  sha: string;
  data_lib: string;
  lib_stack: string[];
  data_shape: string | null;
  selector: string;
  tag: string;
  classes: string[];
  text_quote: string | null;
  bbox: { x: number; y: number; w: number; h: number };
  viewport: { w: number; h: number };
}

export interface ReadyInfo {
  path: string;
  sha: string;
  viewport: { w: number; h: number };
}

export interface BridgeStats {
  accepted: number;
  /** event.origin did not match the preview origin (or no preview origin resolved). */
  wrongOrigin: number;
  /** right origin, but event.source was not the iframe's window. */
  wrongSource: number;
  /** not a plain object, no string type, or over the 16 KB message cap. */
  malformed: number;
  /** a type the shipped overlay never posts (dp:publish, dp:apply, dp:rollback, anything else). */
  unknownType: number;
  /** a known type that failed its schema (caps, shapes, finiteness). */
  invalid: number;
}

export interface BridgeOptions {
  /** `session.preview_url`. Its origin is the only origin the bridge listens to and posts to. */
  previewUrl: string | null | undefined;
  /** The iframe's `contentWindow`, read at event time (the frame may reload). */
  getIframeWindow: () => Window | null | undefined;
  onPacket?: (draft: PinDraft) => void;
  onNavigate?: (nav: { path: string }) => void;
  onReady?: (info: ReadyInfo) => void;
  /** The overlay left select mode on its own (Esc). Always `false`. */
  onSelectChange?: (on: boolean) => void;
  onBlocked?: (info: { what: 'form' }) => void;
}

export interface Bridge {
  /** Start listening on `target` (default `window`). Idempotent. */
  attach(target?: Window): void;
  /** Stop listening. After this no message is handled. Idempotent. */
  detach(): void;
  /** Post one parent -> overlay message. Returns false (and posts nothing) when refused. */
  send(msg: unknown): boolean;
  /** The resolved preview origin, or null when previewUrl is missing or not http(s). */
  readonly origin: string | null;
  /** Debug counters only; never drives behavior. */
  stats(): BridgeStats;
}

// ---------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------

/** The origin of an http(s) preview URL, else null. Opaque origins ("null") are never usable. */
export function previewOriginOf(previewUrl: string | null | undefined): string | null {
  if (!previewUrl) return null;
  try {
    const u = new URL(previewUrl);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (!u.origin || u.origin === 'null') return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function pinDraftWidth(draft: PinDraft): number {
  return draft.viewport.w;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** JSON size under the cap; structured clone can carry cycles, which JSON.stringify refuses (rejected too). */
function withinSize(v: unknown): boolean {
  try {
    const s = JSON.stringify(v);
    return typeof s === 'string' && s.length <= BRIDGE_CAPS.messageChars;
  } catch {
    return false;
  }
}

function toPinDraft(p: z.infer<typeof packetMessageSchema>): PinDraft {
  return {
    path: p.path,
    sha: p.sha,
    data_lib: p.data_lib,
    lib_stack: [...p.lib_stack],
    data_shape: p.data_shape === '' ? null : p.data_shape,
    selector: p.selector,
    tag: p.tag,
    classes: [...p.classes],
    text_quote: p.text_quote === '' ? null : p.text_quote,
    bbox: { x: p.bbox.x, y: p.bbox.y, w: p.bbox.w, h: p.bbox.h },
    viewport: { w: p.viewport.w, h: p.viewport.h },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------------------------------------

export function createBridge(options: BridgeOptions): Bridge {
  const origin = previewOriginOf(options.previewUrl);
  const counts: BridgeStats = { accepted: 0, wrongOrigin: 0, wrongSource: 0, malformed: 0, unknownType: 0, invalid: 0 };
  let target: Window | null = null;

  function frameWindow(): Window | null {
    try {
      return options.getIframeWindow() ?? null;
    } catch {
      return null;
    }
  }

  function handle(event: MessageEvent): void {
    if (target === null) return;
    if (origin === null || event.origin !== origin) {
      counts.wrongOrigin++;
      return;
    }
    const win = frameWindow();
    if (win === null || event.source === null || event.source !== win) {
      counts.wrongSource++;
      return;
    }
    const data: unknown = event.data;
    if (!isPlainRecord(data) || typeof data.type !== 'string' || data.type.length > BRIDGE_CAPS.typeChars || !withinSize(data)) {
      counts.malformed++;
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(INBOUND_SCHEMAS, data.type)) {
      counts.unknownType++;
      return;
    }
    const type = data.type as InboundType;
    switch (type) {
      case 'dp:packet': {
        const r = packetMessageSchema.safeParse(data);
        if (!r.success) return void counts.invalid++;
        counts.accepted++;
        options.onPacket?.(toPinDraft(r.data));
        return;
      }
      case 'dp:ready': {
        const r = readyMessageSchema.safeParse(data);
        if (!r.success) return void counts.invalid++;
        counts.accepted++;
        options.onReady?.({ path: r.data.path, sha: r.data.sha, viewport: { w: r.data.viewport.w, h: r.data.viewport.h } });
        return;
      }
      case 'dp:navigate': {
        const r = navigateMessageSchema.safeParse(data);
        if (!r.success) return void counts.invalid++;
        counts.accepted++;
        options.onNavigate?.({ path: r.data.path });
        return;
      }
      case 'dp:select': {
        const r = selectFromOverlaySchema.safeParse(data);
        if (!r.success) return void counts.invalid++;
        counts.accepted++;
        options.onSelectChange?.(false);
        return;
      }
      case 'dp:blocked': {
        const r = blockedMessageSchema.safeParse(data);
        if (!r.success) return void counts.invalid++;
        counts.accepted++;
        options.onBlocked?.({ what: 'form' });
        return;
      }
    }
  }

  const listener = (event: Event) => handle(event as MessageEvent);

  return {
    origin,
    attach(on?: Window) {
      if (target !== null) return;
      const w = on ?? (typeof window !== 'undefined' ? window : null);
      if (!w) return;
      target = w;
      w.addEventListener('message', listener);
    },
    detach() {
      if (target === null) return;
      target.removeEventListener('message', listener);
      target = null;
    },
    send(msg: unknown): boolean {
      if (origin === null) return false;
      const r = outboundMessageSchema.safeParse(msg);
      if (!r.success) return false;
      const win = frameWindow();
      if (win === null) return false;
      try {
        win.postMessage(r.data, origin);
        return true;
      } catch {
        return false;
      }
    },
    stats() {
      return { ...counts };
    },
  };
}
