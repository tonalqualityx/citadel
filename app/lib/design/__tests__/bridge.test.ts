import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { z } from 'zod';

// pins.ts is server code (Prisma); the test imports only its zod schema to prove the draft is a valid route body.
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }));

import { pinBodySchema } from '../pins';
import { createBridge, BRIDGE_CAPS, pinDraftWidth, previewOriginOf, type PinDraft, type BridgeOptions } from '../bridge';
import { useDesignBridge } from '@/lib/hooks/use-design-bridge';

const PREVIEW = 'https://design-0a1b2c3d.vcdp.pages.dev/about/';
const ORIGIN = 'https://design-0a1b2c3d.vcdp.pages.dev';

/** A dp:packet exactly as design-overlay.js builds it. */
function packet(over: Record<string, unknown> = {}) {
  return {
    type: 'dp:packet',
    path: '/about/',
    sha: 'f3c8214aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5',
    data_lib: 'state_card',
    lib_stack: ['state_card', 'card_grid', 'section'],
    data_shape: 'tall',
    selector: 'section[data-lib="section"]:nth-of-type(2) div[data-lib="card_grid"]:nth-of-type(1) article[data-lib="state_card"]:nth-of-type(3) > h3:nth-of-type(1)',
    tag: 'h3',
    classes: ['card__title', 'text-lg'],
    text_quote: 'Vermont Center for Deaf Programs',
    bbox: { x: 24, y: -310, w: 342, h: 188 },
    viewport: { w: 390, h: 844 },
    ...over,
  };
}

let frames: HTMLIFrameElement[] = [];
function makeFrame(): HTMLIFrameElement {
  const f = document.createElement('iframe');
  document.body.appendChild(f);
  frames.push(f);
  return f;
}

function post(data: unknown, origin: string, source: Window | null) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

function setup(over: Partial<BridgeOptions> = {}) {
  const frame = makeFrame();
  const cb = {
    onPacket: vi.fn(),
    onNavigate: vi.fn(),
    onReady: vi.fn(),
    onSelectChange: vi.fn(),
    onBlocked: vi.fn(),
  };
  const bridge = createBridge({ previewUrl: PREVIEW, getIframeWindow: () => frame.contentWindow, ...cb, ...over });
  bridge.attach();
  const fromFrame = (data: unknown, origin = ORIGIN) => post(data, origin, frame.contentWindow);
  const totalCalls = () => Object.values(cb).reduce((n, f) => n + f.mock.calls.length, 0);
  return { frame, cb, bridge, fromFrame, totalCalls };
}

const fetchSpy = vi.fn();
let xhrOpen: ReturnType<typeof vi.spyOn>;
let xhrSend: ReturnType<typeof vi.spyOn>;
let beacon: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy.mockReset();
  vi.stubGlobal('fetch', fetchSpy);
  xhrOpen = vi.spyOn(XMLHttpRequest.prototype, 'open');
  xhrSend = vi.spyOn(XMLHttpRequest.prototype, 'send');
  beacon = vi.fn();
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true, writable: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const f of frames) f.remove();
  frames = [];
});

function expectNoNetwork() {
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(xhrOpen).not.toHaveBeenCalled();
  expect(xhrSend).not.toHaveBeenCalled();
  expect(beacon).not.toHaveBeenCalled();
}

describe('createBridge: origin and source', () => {
  it('ignores a valid packet from the wrong origin', () => {
    const { cb, bridge, fromFrame, totalCalls } = setup();
    fromFrame(packet(), 'https://evil.example');
    fromFrame(packet(), 'https://design-0a1b2c3d.vcdp.pages.dev.evil.example');
    fromFrame(packet(), 'http://design-0a1b2c3d.vcdp.pages.dev'); // scheme differs
    fromFrame(packet(), 'null');
    expect(totalCalls()).toBe(0);
    expect(cb.onPacket).not.toHaveBeenCalled();
    expect(bridge.stats().wrongOrigin).toBe(4);
  });

  it('ignores the right origin from the wrong source (another window, the parent itself, or no source)', () => {
    const { bridge, totalCalls } = setup();
    const other = makeFrame();
    post(packet(), ORIGIN, other.contentWindow);
    post(packet(), ORIGIN, window);
    post(packet(), ORIGIN, null);
    expect(totalCalls()).toBe(0);
    expect(bridge.stats().wrongSource).toBe(3);
  });

  it('never matches a null source when the iframe has no window', () => {
    const cb = { onPacket: vi.fn() };
    const bridge = createBridge({ previewUrl: PREVIEW, getIframeWindow: () => null, ...cb });
    bridge.attach();
    post(packet(), ORIGIN, null);
    expect(cb.onPacket).not.toHaveBeenCalled();
    expect(bridge.send({ type: 'dp:select', on: true })).toBe(false);
    bridge.detach();
  });

  it('refuses non-http(s) and missing preview urls entirely', () => {
    expect(previewOriginOf('data:text/html,hi')).toBeNull();
    expect(previewOriginOf('javascript:alert(1)')).toBeNull();
    expect(previewOriginOf('not a url')).toBeNull();
    expect(previewOriginOf(null)).toBeNull();
    expect(previewOriginOf(PREVIEW)).toBe(ORIGIN);
    const { cb, bridge, fromFrame } = setup({ previewUrl: 'data:text/html,x' });
    fromFrame(packet(), 'null');
    expect(cb.onPacket).not.toHaveBeenCalled();
    expect(bridge.send({ type: 'dp:select', on: true })).toBe(false);
    bridge.detach();
  });
});

describe('createBridge: validation and caps', () => {
  const rejects: [string, Record<string, unknown>][] = [
    ['selector over 500', { selector: 'a'.repeat(BRIDGE_CAPS.selector + 1) }],
    ['text_quote over 200', { text_quote: 'x'.repeat(BRIDGE_CAPS.textQuote + 1) }],
    ['lib_stack deeper than 8', { lib_stack: Array.from({ length: 9 }, (_, i) => `lib_${i}`) }],
    ['more than 20 classes', { classes: Array.from({ length: 21 }, (_, i) => `c${i}`) }],
    ['a class over 60', { classes: ['c'.repeat(61)] }],
    ['data_shape over 60', { data_shape: 's'.repeat(61) }],
    ['empty selector', { selector: '' }],
    ['bbox missing h', { bbox: { x: 1, y: 2, w: 3 } }],
    ['bbox as array', { bbox: [1, 2, 3, 4] }],
    ['bbox string number', { bbox: { x: '1', y: 2, w: 3, h: 4 } }],
    ['bbox Infinity', { bbox: { x: Infinity, y: 2, w: 3, h: 4 } }],
    ['bbox NaN', { bbox: { x: 1, y: NaN, w: 3, h: 4 } }],
    ['bbox negative width', { bbox: { x: 1, y: 2, w: -3, h: 4 } }],
    ['viewport width 0', { viewport: { w: 0, h: 800 } }],
    ['viewport fractional', { viewport: { w: 390.5, h: 800 } }],
    ['viewport Infinity', { viewport: { w: Infinity, h: 800 } }],
    ['path not rooted', { path: 'https://evil.example/' }],
    ['protocol-relative path', { path: '//evil.example/x' }],
    ['data_lib with markup', { data_lib: '<img src=x>' }],
    ['lib_stack entry uppercase', { lib_stack: ['State_Card'] }],
    ['tag over 40', { tag: 't'.repeat(41) }],
    ['missing sha', { sha: undefined }],
    ['sha over 64', { sha: 'a'.repeat(65) }],
  ];
  it.each(rejects)('rejects a packet with %s (no callback, not truncated)', (_name, over) => {
    const { bridge, fromFrame, totalCalls } = setup();
    fromFrame(packet(over));
    expect(totalCalls()).toBe(0);
    expect(bridge.stats().invalid).toBe(1);
    expect(bridge.stats().accepted).toBe(0);
  });

  it('accepts exactly the caps (500 / 200 / 8 / 20)', () => {
    const { cb, fromFrame } = setup();
    fromFrame(
      packet({
        selector: 'a'.repeat(500),
        text_quote: 'x'.repeat(200),
        lib_stack: Array.from({ length: 8 }, (_, i) => `lib_${i}`),
        classes: Array.from({ length: 20 }, () => 'c'.repeat(60)),
      }),
    );
    expect(cb.onPacket).toHaveBeenCalledTimes(1);
    expect(cb.onPacket.mock.calls[0][0].selector).toHaveLength(500);
  });

  it('rejects non-objects, a non-string type, oversize messages and cyclic data', () => {
    const { bridge, fromFrame, totalCalls } = setup();
    fromFrame('dp:packet');
    fromFrame(null);
    fromFrame([packet()]);
    fromFrame({ type: 42 });
    fromFrame({ ...packet(), padding: 'p'.repeat(BRIDGE_CAPS.messageChars) });
    const cyclic: Record<string, unknown> = { type: 'dp:navigate', path: '/' };
    cyclic.self = cyclic;
    fromFrame(cyclic);
    expect(totalCalls()).toBe(0);
    expect(bridge.stats().malformed).toBe(6);
  });

  it.each(['dp:publish', 'dp:apply', 'dp:rollback', 'dp:confirm', 'dp:fetch', 'dp:pin', 'publish', 'constructor', '__proto__', 'hasOwnProperty'])(
    'ignores the unknown type %s: no callback, no network, counted only',
    (type) => {
      const { bridge, fromFrame, totalCalls } = setup();
      fromFrame({ ...packet(), type, url: '/api/design/publishes/x/confirm', method: 'POST' });
      expect(totalCalls()).toBe(0);
      expect(bridge.stats().unknownType).toBe(1);
      expectNoNetwork();
    },
  );

  it('ignores dp:select {on:true} from the frame (the frame cannot switch select mode on)', () => {
    const { cb, bridge, fromFrame } = setup();
    fromFrame({ type: 'dp:select', on: true });
    fromFrame({ type: 'dp:select', on: 'false' });
    expect(cb.onSelectChange).not.toHaveBeenCalled();
    expect(bridge.stats().invalid).toBe(2);
  });

  it('ignores dp:blocked for anything but a form', () => {
    const { cb, fromFrame } = setup();
    fromFrame({ type: 'dp:blocked', what: 'publish' });
    expect(cb.onBlocked).not.toHaveBeenCalled();
  });
});

describe('createBridge: valid messages', () => {
  it('a valid packet produces exactly one PinDraft that the pins route schema accepts unchanged', () => {
    const { cb, fromFrame } = setup();
    fromFrame(packet());
    expect(cb.onPacket).toHaveBeenCalledTimes(1);
    const draft: PinDraft = cb.onPacket.mock.calls[0][0];
    const p = packet();
    expect(draft).toEqual({
      path: p.path,
      sha: p.sha,
      data_lib: p.data_lib,
      lib_stack: p.lib_stack,
      data_shape: p.data_shape,
      selector: p.selector,
      tag: p.tag,
      classes: p.classes,
      text_quote: p.text_quote,
      bbox: p.bbox,
      viewport: p.viewport,
    });
    expect('type' in draft).toBe(false);
    expect('width' in draft).toBe(false);
    expect(pinDraftWidth(draft)).toBe(390);

    const parsed = pinBodySchema.safeParse(draft);
    expect(parsed.success).toBe(true);
    // The route keeps every field the draft carries (nothing silently stripped or rewritten).
    expect(parsed.success && parsed.data).toEqual(draft);
    expect(parsed.success && parsed.data.viewport.w).toBe(390);
    expect(parsed.success && parsed.data.sha).toBe(p.sha);
  });

  it('maps empty data_shape and text_quote to null as the route does, and the route accepts it', () => {
    const { cb, fromFrame } = setup();
    fromFrame(packet({ data_shape: '', text_quote: '', classes: [], lib_stack: ['state_card'] }));
    const draft: PinDraft = cb.onPacket.mock.calls[0][0];
    expect(draft.data_shape).toBeNull();
    expect(draft.text_quote).toBeNull();
    expect(pinBodySchema.parse(draft)).toEqual(draft);
  });

  it('PinDraft is assignable to the pins route body type', () => {
    expectTypeOf<PinDraft>().toExtend<z.input<typeof pinBodySchema>>();
  });

  it('strips any extra field the frame adds from the draft', () => {
    const { cb, fromFrame } = setup();
    fromFrame({ ...packet(), note: 'publish now', status: 'sent', session_id: 'x' });
    const draft = cb.onPacket.mock.calls[0][0];
    expect(draft).not.toHaveProperty('note');
    expect(draft).not.toHaveProperty('status');
    expect(draft).not.toHaveProperty('session_id');
  });

  it('routes dp:ready, dp:navigate, dp:blocked and dp:select {on:false} to their callbacks', () => {
    const { cb, fromFrame } = setup();
    fromFrame({ type: 'dp:ready', path: '/about/', sha: 'unknown', viewport: { w: 1280, h: 800 } });
    fromFrame({ type: 'dp:navigate', path: '/contact/' });
    fromFrame({ type: 'dp:blocked', what: 'form' });
    fromFrame({ type: 'dp:select', on: false });
    expect(cb.onReady).toHaveBeenCalledWith({ path: '/about/', sha: 'unknown', viewport: { w: 1280, h: 800 } });
    expect(cb.onNavigate).toHaveBeenCalledWith({ path: '/contact/' });
    expect(cb.onBlocked).toHaveBeenCalledWith({ what: 'form' });
    expect(cb.onSelectChange).toHaveBeenCalledWith(false);
    expect(cb.onPacket).not.toHaveBeenCalled();
  });

  it('no inbound message of any kind invokes fetch, XMLHttpRequest or sendBeacon', () => {
    const { fromFrame } = setup();
    const msgs: unknown[] = [
      packet(),
      { type: 'dp:ready', path: '/', sha: 'abc', viewport: { w: 390, h: 844 } },
      { type: 'dp:navigate', path: '/x/' },
      { type: 'dp:blocked', what: 'form' },
      { type: 'dp:select', on: false },
      { type: 'dp:publish' },
      { type: 'dp:apply', pin_ids: ['a'] },
      { type: 'dp:rollback' },
      packet({ selector: 'a'.repeat(501) }),
    ];
    for (const m of msgs) fromFrame(m);
    for (const m of msgs) post(m, 'https://evil.example', window);
    expectNoNetwork();
  });

  it('detach stops all handling; attach is idempotent (one callback per message)', () => {
    const { cb, bridge, fromFrame } = setup();
    bridge.attach();
    bridge.attach();
    fromFrame(packet());
    expect(cb.onPacket).toHaveBeenCalledTimes(1);
    bridge.detach();
    fromFrame(packet());
    fromFrame({ type: 'dp:navigate', path: '/' });
    expect(cb.onPacket).toHaveBeenCalledTimes(1);
    expect(cb.onNavigate).not.toHaveBeenCalled();
    bridge.detach();
  });
});

describe('createBridge: send', () => {
  it('posts only to the iframe window with the preview origin as targetOrigin', () => {
    const { frame, bridge } = setup();
    const spy = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    const parentSpy = vi.spyOn(window, 'postMessage');
    expect(bridge.send({ type: 'dp:select', on: true })).toBe(true);
    expect(bridge.send({ type: 'dp:highlight', selector: 'h3' })).toBe(true);
    expect(bridge.send({ type: 'dp:scroll', selector: 'h3' })).toBe(true);
    expect(spy.mock.calls).toEqual([
      [{ type: 'dp:select', on: true }, ORIGIN],
      [{ type: 'dp:highlight', selector: 'h3' }, ORIGIN],
      [{ type: 'dp:scroll', selector: 'h3' }, ORIGIN],
    ]);
    expect(parentSpy).not.toHaveBeenCalled();
    bridge.detach();
  });

  it('refuses unknown or malformed outbound messages', () => {
    const { frame, bridge } = setup();
    const spy = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    for (const m of [
      { type: 'dp:publish' },
      packet(),
      { type: 'dp:ready' },
      { type: 'dp:select', on: 'yes' },
      { type: 'dp:select', on: true, extra: 1 },
      { type: 'dp:highlight', selector: 'x'.repeat(501) },
      { type: 'dp:scroll' },
      'dp:select',
      null,
    ]) {
      expect(bridge.send(m)).toBe(false);
    }
    expect(spy).not.toHaveBeenCalled();
    bridge.detach();
  });
});

describe('useDesignBridge', () => {
  function renderBridge(initialUrl: string | null) {
    const frame = makeFrame();
    const iframeRef = { current: frame };
    const hook = renderHook(({ url }) => useDesignBridge({ iframeRef, previewUrl: url }), { initialProps: { url: initialUrl } });
    const send = (data: unknown, origin: string) => act(() => post(data, origin, frame.contentWindow));
    return { frame, hook, send };
  }

  it('setSelectMode posts dp:select; dp:select {on:false} from the overlay flips it off', () => {
    const { frame, hook, send } = renderBridge(PREVIEW);
    const spy = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    act(() => hook.result.current.setSelectMode(true));
    expect(hook.result.current.selectMode).toBe(true);
    expect(spy).toHaveBeenLastCalledWith({ type: 'dp:select', on: true }, ORIGIN);
    send({ type: 'dp:select', on: false }, 'https://evil.example');
    expect(hook.result.current.selectMode).toBe(true);
    send({ type: 'dp:select', on: false }, ORIGIN);
    expect(hook.result.current.selectMode).toBe(false);
    hook.unmount();
  });

  it('collects drafts from valid packets only, and tracks ready and path', () => {
    const { hook, send } = renderBridge(PREVIEW);
    send({ type: 'dp:ready', path: '/about/', sha: 'abc', viewport: { w: 390, h: 844 } }, ORIGIN);
    expect(hook.result.current.ready).toBe(true);
    expect(hook.result.current.path).toBe('/about/');
    send(packet(), ORIGIN);
    send(packet({ selector: 'a'.repeat(501) }), ORIGIN);
    send(packet(), 'https://evil.example');
    send({ type: 'dp:navigate', path: '/contact/' }, ORIGIN);
    expect(hook.result.current.drafts).toHaveLength(1);
    expect(pinBodySchema.safeParse(hook.result.current.drafts[0].draft).success).toBe(true);
    expect(hook.result.current.path).toBe('/contact/');
    act(() => hook.result.current.removeDraft(hook.result.current.drafts[0].id));
    expect(hook.result.current.drafts).toHaveLength(0);
    expectNoNetwork();
    hook.unmount();
  });

  it('re-sends select mode after a page load in the frame (the overlay starts with it off)', () => {
    const { frame, hook, send } = renderBridge(PREVIEW);
    const spy = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    act(() => hook.result.current.setSelectMode(true));
    spy.mockClear();
    send({ type: 'dp:ready', path: '/next/', sha: 'abc', viewport: { w: 390, h: 844 } }, ORIGIN);
    expect(spy).toHaveBeenCalledWith({ type: 'dp:select', on: true }, ORIGIN);
    hook.unmount();
  });

  it('re-attaches with the new origin when preview_url changes', () => {
    const NEXT = 'https://design-0a1b2c3d-2.vcdp.pages.dev/';
    const NEXT_ORIGIN = 'https://design-0a1b2c3d-2.vcdp.pages.dev';
    const { frame, hook, send } = renderBridge(PREVIEW);
    act(() => hook.result.current.setSelectMode(true));
    hook.rerender({ url: NEXT });
    expect(hook.result.current.selectMode).toBe(false);
    expect(hook.result.current.ready).toBe(false);
    send(packet(), ORIGIN); // the old origin is no longer heard
    expect(hook.result.current.drafts).toHaveLength(0);
    send(packet(), NEXT_ORIGIN);
    expect(hook.result.current.drafts).toHaveLength(1);
    const spy = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    act(() => hook.result.current.setSelectMode(true));
    expect(spy).toHaveBeenLastCalledWith({ type: 'dp:select', on: true }, NEXT_ORIGIN);
    hook.unmount();
  });

  it('with no preview_url hears nothing and posts nothing', () => {
    const { frame, hook, send } = renderBridge(null);
    const spy = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => undefined);
    send(packet(), ORIGIN);
    act(() => hook.result.current.setSelectMode(true));
    expect(hook.result.current.drafts).toHaveLength(0);
    expect(spy).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('detaches on unmount', () => {
    const { hook, frame } = renderBridge(PREVIEW);
    const remove = vi.spyOn(window, 'removeEventListener');
    hook.unmount();
    expect(remove).toHaveBeenCalledWith('message', expect.any(Function));
    const result = hook.result.current;
    act(() => post(packet(), ORIGIN, frame.contentWindow));
    expect(result.drafts).toHaveLength(0);
  });
});
