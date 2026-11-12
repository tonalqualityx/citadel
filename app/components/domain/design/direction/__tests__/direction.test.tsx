import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { DirectionTab } from '../DirectionTab';
import { mergePatchForTest } from './merge';
import type { DirectionBody, DirectionResponse } from '@/lib/hooks/use-design-direction';

type Call = { method: string; url: string; body: Record<string, unknown> | null };

const FULL: DirectionBody = {
  summary: 'Plain and square.',
  nav: { desktop: { pattern: 'inline' }, mobile: { pattern: 'drawer_right' } },
  container: { max_content_px: 1280 },
};

let calls: Call[];
let state: DirectionResponse;
let patchError: { status: number; error: string; code: string } | null;
let signError: { status: number; error: string; code: string } | null;
let reviseError: { status: number; error: string; code: string } | null;
let saves: number;

const direction = (body: DirectionBody, over: Record<string, unknown> = {}) => ({
  id: 'd1', version: 3, status: 'draft', body, drafted_by: 'designer', signed_at: null, created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z', revision: 'rev-1', ...over,
});
const respond = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  calls = [];
  patchError = null;
  signError = null;
  reviseError = null;
  saves = 0;
  state = { direction: direction(FULL) as never, signed: null, missing_client_requests: [], sign_gaps: [] };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ method, url, body });
    if (method === 'GET') return respond(200, state);
    if (url.endsWith('/sign')) {
      if (signError) return respond(signError.status, signError);
      // like the server: only the revision on screen can be signed
      if (body?.base_revision !== state.direction?.revision) return respond(409, { error: 'The art direction changed; reload', code: 'version_moved' });
      return respond(200, { direction: state.direction, stage: 'home_build' });
    }
    if (url.endsWith('/revise')) return reviseError ? respond(reviseError.status, reviseError) : respond(201, { direction: direction({}) });
    if (patchError) return respond(patchError.status, patchError);
    const d = state.direction!;
    if (body?.base_revision !== undefined && body.base_revision !== d.revision) return respond(409, { error: 'The art direction changed; reload', code: 'version_moved' });
    const merged = mergePatchForTest(d.body, (body as { patch: unknown }).patch) as DirectionBody;
    saves += 1;
    state = { ...state, direction: { ...d, body: merged, revision: `rev-saved-${saves}` } };
    return respond(200, { direction: state.direction });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const track = (over: Record<string, unknown> = {}) => ({ id: 't1', stage: 'art_direction', busy: false, busy_line: null, preview_alias: 'a', preview_url: null, finish: null, ...over });

function mount(trackOver: Record<string, unknown> = {}, nextPollMs?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const feed = nextPollMs ? ({ next_poll_ms: nextPollMs } as never) : undefined;
  const ui = (f: unknown) => (
    <QueryClientProvider client={qc}>
      <DirectionTab sessionId="s1" track={track(trackOver) as never} feed={f as never} />
    </QueryClientProvider>
  );
  const out = render(ui(feed));
  return { ...out, setFeed: (f: unknown) => out.rerender(ui(f)) };
}

const field = (key: string) => {
  const el = document.querySelector(`[data-field="${key}"]`);
  if (!el) throw new Error(`no field ${key}`);
  return el.querySelector('input,textarea,select') as HTMLInputElement;
};
const patches = () => calls.filter((c) => c.method === 'PATCH');
const lastPatch = () => patches()[patches().length - 1].body;

describe('Direction tab: form and saving', () => {
  const cases: Array<[string, string, string, Record<string, unknown>]> = [
    ['summary', 'summary', 'Warm and plain.', { summary: 'Warm and plain.' }],
    ['feel', 'feel.words', 'plain, square', { feel: { words: ['plain', 'square'] } }],
    ['type', 'type.display.family', 'Spectral', { type: { display: { family: 'Spectral' } } }],
    ['colour', 'colour.accent_job', 'primary button only', { colour: { accent_job: 'primary button only' } }],
    ['imagery', 'imagery.treatment', 'warm light', { imagery: { treatment: 'warm light' } }],
    ['layout', 'layout.density', '1', { layout: { density: 'balanced' } }],
    ['navigation desktop', 'nav.desktop.pattern', '2', { nav: { desktop: { pattern: 'split' } } }],
    ['navigation phone', 'nav.mobile.pattern', '3', { nav: { mobile: { pattern: 'bottom_bar' } } }],
    ['page width', 'container.max_content_px', '1440', { container: { max_content_px: 1440 } }],
    ['page width gutters', 'container.gutters_px.phone', '16', { container: { gutters_px: { phone: 16 } } }],
    ['motion', 'motion.level', '1', { motion: { level: 'subtle' } }],
    ['avoid', 'avoid', 'popups\ndistressed fonts', { avoid: ['popups', 'distressed fonts'] }],
    ['open questions', 'open_questions', 'Who signs the photos?', { open_questions: ['Who signs the photos?'] }],
  ];
  it.each(cases)('%s group saves the right patch with base_version', async (_name, key, value, expected) => {
    mount();
    await screen.findByTestId('direction-tab');
    const el = field(key);
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value } });
    fireEvent.blur(el);
    await waitFor(() => expect(patches().length).toBe(1));
    expect(lastPatch()).toEqual({ patch: expected, base_version: 3, base_revision: 'rev-1' });
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('Saved'));
  });

  it('features and flair add a record with an id and save the whole list', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add a feature' }));
    await waitFor(() => expect(patches().length).toBe(1), { timeout: 3000 });
    expect(lastPatch()).toEqual({ patch: { features: [{ id: 'f1', name: '', build_as: 'new_component' }] }, base_version: 3, base_revision: 'rev-1' });
    fireEvent.click(screen.getByRole('button', { name: 'Add flair' }));
    await waitFor(() => expect(patches().length).toBe(2), { timeout: 3000 });
    // the second save carries the revision the first save answered with
    expect(lastPatch()).toEqual({ patch: { flair: [{ id: 'fl1', kind: 'other' }] }, base_version: 3, base_revision: 'rev-saved-1' });
  });

  it('clearing a field sends null so the server removes it', async () => {
    state = { ...state, direction: direction({ ...FULL, motion: { level: 'subtle' } }) as never };
    mount();
    await screen.findByTestId('direction-tab');
    const el = field('motion.level');
    fireEvent.change(el, { target: { value: '' } });
    fireEvent.blur(el);
    await waitFor(() => expect(patches().length).toBe(1));
    expect(lastPatch()).toEqual({ patch: { motion: { level: null } }, base_version: 3, base_revision: 'rev-1' });
  });

  it('shows Saving then Saved in a polite live region, and a number outside its range is explained and not sent', async () => {
    mount();
    await screen.findByTestId('direction-tab');
    expect(screen.getByTestId('save-status').getAttribute('aria-live')).toBe('polite');
    const el = field('container.max_content_px');
    fireEvent.change(el, { target: { value: '99999' } });
    fireEvent.blur(el);
    expect(await screen.findByText('Use a whole number from 320 to 3840.')).toBeTruthy();
    await new Promise((r) => setTimeout(r, 50));
    expect(patches().length).toBe(0);
  });

  it('shows the server message when it refuses a change', async () => {
    patchError = { status: 400, error: 'Validation failed', code: 'bad' };
    mount();
    await screen.findByTestId('direction-tab');
    const el = field('summary');
    fireEvent.change(el, { target: { value: 'x' } });
    fireEvent.blur(el);
    expect((await screen.findByRole('alert')).textContent).toContain('Validation failed');
  });
});

describe('Direction tab: version_moved and live updates', () => {
  it('on version_moved shows the notice, keeps the focused field text and shows the latest elsewhere', async () => {
    patchError = { status: 409, error: 'The art direction changed; reload', code: 'version_moved' };
    mount();
    await screen.findByTestId('direction-tab');
    const accent = field('colour.accent_job');
    accent.focus();
    fireEvent.focus(accent);
    fireEvent.change(accent, { target: { value: 'my own words' } });
    state = { ...state, direction: direction({ ...FULL, summary: 'Latest from the assistant.' }, { version: 4 }) as never };
    expect(await screen.findByText('This was just updated. Here is the latest.', {}, { timeout: 3000 })).toBeTruthy();
    expect(field('colour.accent_job').value).toBe('my own words');
    expect(document.activeElement).toBe(field('colour.accent_job'));
    await waitFor(() => expect(field('summary').value).toBe('Latest from the assistant.'));
    // Nothing was re-sent on her behalf.
    expect(patches().length).toBe(1);
  });

  it('a live update changes an unfocused field, marks it Updated in words, and leaves the focused one alone', async () => {
    mount({}, 50);
    await screen.findByTestId('direction-tab');
    const accent = field('colour.accent_job');
    accent.focus();
    fireEvent.focus(accent);
    fireEvent.change(accent, { target: { value: 'typing here' } });
    state = { ...state, direction: direction({ ...FULL, summary: 'Changed by the assistant.', colour: { accent_job: 'assistant value' } }) as never };
    await waitFor(() => expect(field('summary').value).toBe('Changed by the assistant.'), { timeout: 3000 });
    expect(within(document.querySelector('[data-field="summary"]') as HTMLElement).getByText('Updated')).toBeTruthy();
    expect(field('colour.accent_job').value).toBe('typing here');
    expect(within(document.querySelector('[data-field="colour.accent_job"]') as HTMLElement).queryByText('Updated')).toBeNull();
  });
});

describe('Direction tab: sign off', () => {
  const quote = { id: 'n1', quote: 'Keep it simple', speaker_name: 'Brian', polarity: 'require' };
  const signButton = () => screen.getAllByRole('button', { name: 'Sign off' })[0] as HTMLButtonElement;

  it('(a) a missing client request disables Sign off, lists the quote and says why', async () => {
    state = { ...state, missing_client_requests: [quote] };
    mount();
    const list = await screen.findByTestId('missing-request');
    expect(list.textContent).toContain('Keep it simple');
    expect(signButton().disabled).toBe(true);
    expect(screen.getByTestId('sign-reasons').textContent).toContain('1 client request is not answered yet.');
  });

  it('answering a request adds an entry, and an empty answer still blocks sign off', async () => {
    state = { ...state, missing_client_requests: [quote] };
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Answer this request' }));
    await waitFor(() => expect(patches().length).toBe(1), { timeout: 3000 });
    expect(lastPatch()).toEqual({ patch: { client_requests: [{ design_note_id: 'n1', how_honoured: '' }] }, base_version: 3, base_revision: 'rev-1' });
    state = { ...state, missing_client_requests: [] };
    await waitFor(() => expect(screen.getByTestId('sign-reasons').textContent).toContain('Say how each client request is honoured.'), { timeout: 3000 });
    expect(signButton().disabled).toBe(true);
  });

  it('(b) no phone navigation disables it with the reason', async () => {
    state = { ...state, direction: direction({ ...FULL, nav: { desktop: { pattern: 'inline' } } }) as never };
    mount();
    await screen.findByTestId('sign-off');
    expect(signButton().disabled).toBe(true);
    expect(screen.getByTestId('sign-reasons').textContent).toContain('Choose the phone navigation.');
  });

  it('(c) no page width disables it with the reason', async () => {
    state = { ...state, direction: direction({ ...FULL, container: {} }) as never };
    mount();
    await screen.findByTestId('sign-off');
    expect(signButton().disabled).toBe(true);
    expect(screen.getByTestId('sign-reasons').textContent).toContain('Set the page width.');
  });

  it('is enabled when the requests are answered and navigation and width are filled', async () => {
    mount();
    await screen.findByTestId('sign-off');
    expect(signButton().disabled).toBe(false);
  });

  it('the confirm dialog says what signing does, then posts the sign with the base version', async () => {
    mount();
    await screen.findByTestId('sign-off');
    fireEvent.click(signButton());
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Signing fixes the direction. The home page build starts, and the client and Mike receive the direction by email.');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign off' }));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/art-direction/sign'))).toBe(true));
    expect(calls.find((c) => c.url.endsWith('/sign'))!.body).toEqual({ base_version: 3, base_revision: 'rev-1' });
  });

  it('designer_only shows the plain refusal', async () => {
    signError = { status: 403, error: 'Only the designer signs the direction', code: 'designer_only' };
    mount();
    await screen.findByTestId('sign-off');
    fireEvent.click(signButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign off' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Only the designer on this project can sign off.');
  });

  it('a later version asks rebuild or refinements, refinements first, and sends the mode', async () => {
    mount({ stage: 'refine' });
    await screen.findByTestId('sign-off');
    fireEvent.click(signButton());
    const dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByLabelText('Apply the changes to the current home page') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(dialog).getByLabelText('Rebuild the home page from this direction'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign off' }));
    await waitFor(() => expect(calls.find((c) => c.url.endsWith('/sign'))).toBeTruthy());
    expect(calls.find((c) => c.url.endsWith('/sign'))!.body).toEqual({ base_version: 3, mode: 'rebuild', base_revision: 'rev-1' });
  });
});

describe('Direction tab: revisions (the designer signs what her screen shows)', () => {
  const signButton = () => screen.getAllByRole('button', { name: 'Sign off' })[0] as HTMLButtonElement;
  const signs = () => calls.filter((c) => c.method === 'POST' && c.url.endsWith('/sign'));
  const gets = () => calls.filter((c) => c.method === 'GET').length;

  it('a refetch with a new revision and no unsaved edits shows the new body, and Sign off then signs that revision', async () => {
    mount({}, 50);
    await screen.findByTestId('sign-off');
    state = { ...state, direction: direction({ ...FULL, summary: 'The assistant rewrote this.' }, { revision: 'rev-2' }) as never };
    await waitFor(() => expect(field('summary').value).toBe('The assistant rewrote this.'), { timeout: 3000 });
    fireEvent.click(signButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign off' }));
    await waitFor(() => expect(signs()).toHaveLength(1));
    expect(signs()[0].body).toEqual({ base_version: 3, base_revision: 'rev-2' });
  });

  it('an art_direction feed line refetches the direction at once', async () => {
    const { setFeed } = mount({}, 60_000);
    await screen.findByTestId('sign-off');
    await waitFor(() => expect(gets()).toBe(1));
    state = { ...state, direction: direction({ ...FULL, summary: 'Changed from the chat.' }, { revision: 'rev-2' }) as never };
    setFeed({ next_poll_ms: 60_000, events: [{ seq: 7, role: 'system', kind: 'art_direction', payload: { version: 3, status: 'draft' }, created_at: '2026-11-10T00:00:00Z' }] });
    await waitFor(() => expect(field('summary').value).toBe('Changed from the chat.'), { timeout: 3000 });
    expect(gets()).toBe(2);
    // the same line again does not refetch again; another kind does not either
    setFeed({ next_poll_ms: 60_000, events: [{ seq: 7, role: 'system', kind: 'art_direction', payload: {}, created_at: '2026-11-10T00:00:00Z' }, { seq: 8, role: 'worker', kind: 'text', payload: {}, created_at: '2026-11-10T00:00:01Z' }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(gets()).toBe(2);
  });

  it('the dialog signs the revision that was on screen when it opened; when that moved, it closes with the plain message', async () => {
    mount();
    await screen.findByTestId('sign-off');
    fireEvent.click(signButton());
    const dialog = await screen.findByRole('dialog');
    // the worker saves while the dialog is open, before any refetch reaches the screen
    state = { ...state, direction: direction({ ...FULL, summary: 'Saved behind the dialog.' }, { revision: 'rev-2' }) as never };
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sign off' }));
    await waitFor(() => expect(signs()).toHaveLength(1));
    expect(signs()[0].body).toEqual({ base_version: 3, base_revision: 'rev-1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect((await screen.findByRole('alert')).textContent).toBe('This was just updated. Here is the latest.');
    await waitFor(() => expect(field('summary').value).toBe('Saved behind the dialog.'));
  });

  it('a refetch that moves the revision while the dialog is open closes it before anything is signed', async () => {
    mount({}, 50);
    await screen.findByTestId('sign-off');
    fireEvent.click(signButton());
    await screen.findByRole('dialog');
    state = { ...state, direction: direction({ ...FULL, summary: 'Moved while open.' }, { revision: 'rev-3' }) as never };
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull(), { timeout: 3000 });
    expect((await screen.findByRole('alert')).textContent).toBe('This was just updated. Here is the latest.');
    expect(field('summary').value).toBe('Moved while open.');
    expect(signs()).toHaveLength(0);
  });
});

describe('Direction tab: signed and revise', () => {
  const signed = () => {
    state = { ...state, direction: direction(FULL, { status: 'signed', signed_at: '2026-11-05T15:00:00Z' }) as never };
  };

  it('a signed version is read-only with who and when, and no sign off', async () => {
    signed();
    mount({ stage: 'refine' });
    const banner = await screen.findByTestId('signed-banner');
    expect(banner.textContent).toContain('Signed on Nov 5, 2026');
    expect(banner.textContent).toContain('by the designer on this project');
    expect(document.querySelectorAll('input,textarea,select').length).toBe(0);
    expect(screen.queryByTestId('sign-off')).toBeNull();
    expect(screen.getByText('Plain and square.')).toBeTruthy();
  });

  it('Revise direction posts the revise and the new draft becomes editable', async () => {
    signed();
    mount({ stage: 'review' });
    const button = await screen.findByRole('button', { name: 'Revise direction' });
    state = { ...state, direction: direction(FULL, { version: 4 }) as never };
    fireEvent.click(button);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith('/art-direction/revise') && c.method === 'POST')).toBe(true));
    await waitFor(() => expect(field('summary')).toBeTruthy());
  });

  it('shows the server refusal when revising is not allowed', async () => {
    signed();
    reviseError = { status: 409, error: 'The home build has not failed', code: 'illegal_transition' };
    mount({ stage: 'home_build', busy: false });
    fireEvent.click(await screen.findByRole('button', { name: 'Revise direction' }));
    expect((await screen.findByRole('alert')).textContent).toBe('The home build has not failed');
  });

  it('does not offer Revise where the stage does not allow it', async () => {
    signed();
    mount({ stage: 'rest_build' });
    await screen.findByTestId('signed-banner');
    expect(screen.queryByRole('button', { name: 'Revise direction' })).toBeNull();
  });
});

describe('Direction tab: model text is data', () => {
  it('renders HTML in the record and in a client quote as text', async () => {
    const evil = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    state = { ...state, direction: direction({ ...FULL, summary: evil, avoid: [evil] }) as never, missing_client_requests: [{ id: 'n9', quote: evil, polarity: 'avoid' }] };
    const { container } = mount();
    await screen.findByTestId('missing-request');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByTestId('missing-request').textContent).toContain(evil);
    expect(field('summary').value).toBe(evil);
  });

  it('renders HTML as text in the read-only view too', async () => {
    const evil = '<script>window.__x=1</script>';
    state = { ...state, direction: direction({ ...FULL, summary: evil }, { status: 'signed', signed_at: '2026-11-05T15:00:00Z' }) as never };
    const { container } = mount({ stage: 'refine' });
    await screen.findByTestId('signed-banner');
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getByText(evil)).toBeTruthy();
  });
});
