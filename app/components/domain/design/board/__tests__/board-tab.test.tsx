import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a) } }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));

import { BoardTab } from '../BoardTab';
import { UPLOAD_REJECT_SENTENCES } from '@/lib/design/upload-reject';

const S = 's1';
const A = (id: string, over: Record<string, unknown> = {}) => ({
  id, kind: 'ref_fold', content_type: 'image/png', width: 1280, height: 800, page: null, status: 'ready', reject_reason: null,
  url: `/api/design/sessions/${S}/track-assets/${id}`, ...over,
});
const ref = (id: string, over: Record<string, unknown> = {}) => ({
  id, source: 'bast_pick', url: `https://${id}.example.com/`, title: `Site ${id}`, why_md: 'It has a calm grid.', decision: 'pending', decision_note: null,
  capture_status: 'captured', capture_error: null,
  captures: { desktop_fold: A(`${id}-df`), desktop_full: null, phone_fold: A(`${id}-pf`), phone_full: null },
  uploads: [], markups: [], sort_order: 0, ...over,
});

let refs: Array<Record<string, unknown>> = [];
function mount(props: Partial<{ track: unknown }> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const track = (props.track ?? { id: 't', stage: 'board', busy: false, busy_line: null, preview_alias: 'p', preview_url: null, finish: null }) as never;
  return render(<QueryClientProvider client={qc}><BoardTab sessionId={S} track={track} feed={undefined} /></QueryClientProvider>);
}

beforeEach(() => {
  refs = [ref('a'), ref('b')];
  get.mockReset().mockImplementation(async () => ({ references: refs }));
  post.mockReset();
  patch.mockReset().mockResolvedValue({ reference: {} });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const card = (title: string) => screen.getByRole('heading', { name: title }).closest('li') as HTMLElement;

describe('reference cards', () => {
  it('shows the source in words, the why paragraph, desktop first then phone', async () => {
    refs = [ref('a'), ref('c', { source: 'client_named', why_md: 'We like how Acme feels.' })];
    mount();
    await screen.findByText('Site a');
    expect(card('Site a').textContent).toContain('Picked by Bast');
    expect(within(card('Site a')).getByText('Why Bast picked it')).toBeTruthy();
    expect(card('Site c').textContent).toContain('Named by the client');
    expect(within(card('Site c')).getByText('What the client said')).toBeTruthy();
    const imgs = within(card('Site a')).getAllByRole('img');
    expect(imgs[0].getAttribute('alt')).toContain('Desktop');
    expect(imgs[1].getAttribute('alt')).toContain('Phone');
  });

  it('renders text that contains HTML as text', async () => {
    refs = [ref('x', { title: '<b>Bold</b> site', why_md: '<img src=x onerror=alert(1)> hello' })];
    const { container } = mount();
    await screen.findByText('<b>Bold</b> site');
    expect(screen.getByTestId('why-text').textContent).toBe('<img src=x onerror=alert(1)> hello');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img[onerror]')).toBeNull();
  });

  it('never gives an image a src outside the session track-assets route', async () => {
    refs = [ref('a', { captures: { desktop_fold: A('ok'), desktop_full: null, phone_fold: A('evil', { url: 'https://evil.example.com/x.png' }), phone_full: null } })];
    const { container } = mount();
    await screen.findByText('Site a');
    const srcs = Array.from(container.querySelectorAll('img')).map((i) => i.getAttribute('src'));
    expect(srcs).toEqual([`/api/design/sessions/${S}/track-assets/ok`]);
    for (const s of srcs) expect(s!.startsWith(`/api/design/sessions/${S}/track-assets/`)).toBe(true);
  });
});

describe('yes and no', () => {
  it('Yes is one tap, aria-pressed, saved with PATCH', async () => {
    mount();
    await screen.findByText('Site a');
    const yes = within(card('Site a')).getByRole('button', { name: /^Yes/ });
    expect(yes.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(yes);
    await waitFor(() => expect(yes.getAttribute('aria-pressed')).toBe('true'));
    expect(patch).toHaveBeenCalledWith(`/design/sessions/${S}/references/a`, { decision: 'yes' });
  });

  it('puts the choice back when the save fails with a 500', async () => {
    patch.mockRejectedValueOnce(new Error('Internal server error'));
    mount();
    await screen.findByText('Site a');
    const yes = within(card('Site a')).getByRole('button', { name: /^Yes/ });
    fireEvent.click(yes);
    await waitFor(() => expect(within(card('Site a')).getByRole('alert').textContent).toContain('did not save'));
    expect(within(card('Site a')).getByRole('button', { name: /^Yes/ }).getAttribute('aria-pressed')).toBe('false');
  });

  it('sends the optional reason with the choice', async () => {
    mount();
    await screen.findByText('Site a');
    fireEvent.change(within(card('Site a')).getByLabelText(/Reason/), { target: { value: 'Too busy' } });
    fireEvent.click(within(card('Site a')).getByRole('button', { name: /^No/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/design/sessions/${S}/references/a`, { decision: 'no', decision_note: 'Too busy' }));
  });

  it('No moves the card to a collapsed Set aside strip and it can be brought back', async () => {
    mount();
    await screen.findByText('Site a');
    fireEvent.click(within(card('Site a')).getByRole('button', { name: /^No/ }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Site a' })).toBeNull());
    const toggle = screen.getByRole('button', { name: /Set aside \(1\)/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Bring back', { exact: false })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Bring back/ }));
    await screen.findByRole('heading', { name: 'Site a' });
    expect(patch).toHaveBeenLastCalledWith(`/design/sessions/${S}/references/a`, { decision: 'pending' });
    expect(screen.queryByRole('button', { name: /Set aside/ })).toBeNull();
  });
});

describe('add a site', () => {
  it('refuses http: and a bad address, with no request', async () => {
    mount();
    await screen.findByText('Site a');
    const input = screen.getByLabelText('Add a site');
    fireEvent.change(input, { target: { value: 'http://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    expect((await screen.findByRole('alert')).textContent).toContain('https://');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(input, { target: { value: 'not a url' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('web address'));
    expect(post).not.toHaveBeenCalled();
  });

  it('posts {url} and shows the new card as capturing', async () => {
    post.mockResolvedValueOnce({ reference: ref('n', { source: 'designer_url', capture_status: 'queued', captures: { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null }, why_md: null }) });
    mount();
    await screen.findByText('Site a');
    fireEvent.change(screen.getByLabelText('Add a site'), { target: { value: ' https://n.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add site' }));
    await screen.findByText('Site n');
    expect(post).toHaveBeenCalledWith(`/design/sessions/${S}/references`, { url: 'https://n.example.com' });
    expect(within(card('Site n')).getByTestId('capture-chip').textContent).toBe('Capturing');
  });

  it('says each capture status in words, with the reason sentence', async () => {
    const none = { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null };
    refs = [
      ref('q', { capture_status: 'queued', captures: none }),
      ref('ok', { capture_status: 'captured' }),
      ref('f', { capture_status: 'failed', capture_error: 'The page took too long to load.', captures: none }),
      ref('bl', { capture_status: 'blocked', capture_error: 'sandbox_refused', captures: none }),
    ];
    mount();
    await screen.findByText('Site q');
    expect(within(card('Site q')).getByTestId('capture-chip').textContent).toBe('Capturing');
    expect(within(card('Site ok')).getByTestId('capture-chip').textContent).toBe('Captured');
    expect(within(card('Site f')).getByTestId('capture-chip').textContent).toBe('Could not capture');
    expect(within(card('Site f')).getByTestId('capture-sentence').textContent).toBe('The page took too long to load.');
    expect(within(card('Site bl')).getByTestId('capture-chip').textContent).toBe('Blocked');
    expect(within(card('Site bl')).getByTestId('capture-sentence').textContent).not.toContain('sandbox_refused');
  });
});

describe('uploads', () => {
  const file = (name: string, type: string, size = 100) => {
    const f = new File(['x'], name, { type });
    Object.defineProperty(f, 'size', { value: size });
    return f;
  };

  it('uploads through the file input, then makes a card for it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ asset: A('up1', { kind: 'upload', status: 'pending', url: null }) }) });
    vi.stubGlobal('fetch', fetchMock);
    post.mockResolvedValueOnce({ reference: ref('u', { source: 'designer_upload', url: null, title: 'shot.png', why_md: null, capture_status: 'none', captures: { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null }, uploads: [{ asset: A('up1', { kind: 'upload', status: 'ready' }), renders: [] }] }) });
    mount();
    await screen.findByText('Site a');
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [file('shot.png', 'image/png')] } });
    await screen.findByText('shot.png', { selector: 'h3' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/design/sessions/${S}/uploads`);
    expect((init.body as FormData).get('purpose')).toBe('board');
    expect(post).toHaveBeenCalledWith(`/design/sessions/${S}/references`, { upload_asset_ids: ['up1'] });
    expect(screen.getAllByTestId('upload-row')[0].textContent).toContain('Added to the board');
  });

  it('also takes a drop on the board', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'This track already has 100 uploads' }) });
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await screen.findByText('Site a');
    fireEvent.drop(screen.getByTestId('board-drop-zone'), { dataTransfer: { files: [file('d.pdf', 'application/pdf')], types: ['Files'] } });
    await waitFor(() => expect(screen.getAllByTestId('upload-row')[0].textContent).toContain('This track already has 100 uploads'));
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a wrong type and an oversize file before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await screen.findByText('Site a');
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [file('a.svg', 'image/svg+xml'), file('big.png', 'image/png', 26 * 1024 * 1024)] } });
    const rows = await screen.findAllByTestId('upload-row');
    expect(rows[0].textContent).toContain('not accepted');
    expect(rows[1].textContent).toContain('over 25 MB');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a file when the board already holds 100 uploads', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    refs = [ref('many', { uploads: Array.from({ length: 100 }, (_, i) => ({ asset: A(`m${i}`, { kind: 'upload' }), renders: [] })), captures: { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null } })];
    mount();
    await screen.findByText('Site many');
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [file('one.png', 'image/png')] } });
    expect((await screen.findAllByTestId('upload-row'))[0].textContent).toContain('100 uploads');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['too_many_pixels', 'pdf_failed', 'not_an_image', 'svg_refused'] as const)('shows the sentence, never the code, for %s', async (code) => {
    refs = [ref('r', { source: 'designer_upload', url: null, title: 'bad.png', why_md: null, capture_status: 'none', captures: { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null }, uploads: [{ asset: A('r1', { kind: 'upload', status: 'rejected', reject_reason: code, url: null }), renders: [] }] })];
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(UPLOAD_REJECT_SENTENCES[code]);
    expect(alert.textContent).not.toContain(code);
  });
});

describe('markup', () => {
  // jsdom has no layout: give the picture a size we control, like a resized image.
  let size = { width: 200, height: 100 };
  beforeEach(() => {
    size = { width: 200, height: 100 };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ left: 0, top: 0, right: size.width, bottom: size.height, width: size.width, height: size.height, x: 0, y: 0, toJSON: () => ({}) }));
    post.mockResolvedValue({ markup: { id: 'm1', reference_id: 'a', asset_id: 'a-df', rect: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 }, sentiment: 'like', category: 'layout', note: null, deleted: false } });
  });
  afterEach(() => vi.restoreAllMocks());

  const surfaceOf = (title: string) => within(card(title)).getAllByTestId('markup-surface')[0];
  const drag = (el: HTMLElement, from: [number, number], to: [number, number]) => {
    fireEvent.pointerDown(el, { clientX: from[0], clientY: from[1], button: 0, pointerId: 1 });
    fireEvent.pointerMove(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
    fireEvent.pointerUp(el, { clientX: to[0], clientY: to[1], pointerId: 1 });
  };

  it('stores a dragged box as fractions of the picture, whatever size the picture is', async () => {
    mount();
    await screen.findByText('Site a');
    drag(surfaceOf('Site a'), [50, 20], [150, 60]);
    fireEvent.click(await screen.findByLabelText('Like'));
    fireEvent.click(screen.getByLabelText('Layout'));
    fireEvent.click(screen.getByRole('button', { name: 'Save box' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenLastCalledWith(`/design/sessions/${S}/markups`, { reference_id: 'a', asset_id: 'a-df', rect: { x: 0.25, y: 0.2, w: 0.5, h: 0.4 }, sentiment: 'like', category: 'layout' });

    // The picture is now twice as big: the same part of it gives the same fractions.
    size = { width: 400, height: 200 };
    drag(surfaceOf('Site a'), [100, 40], [300, 120]);
    fireEvent.click(await screen.findByLabelText('Dislike'));
    fireEvent.click(screen.getByLabelText('Type'));
    fireEvent.click(screen.getByRole('button', { name: 'Save box' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1].rect).toEqual({ x: 0.25, y: 0.2, w: 0.5, h: 0.4 });
    // A saved box is placed with percentages, so it follows the picture.
    expect(screen.getAllByTestId('markup-box')[0].getAttribute('style')).toContain('left: 25%');
  });

  it('ignores a tiny drag', async () => {
    mount();
    await screen.findByText('Site a');
    drag(surfaceOf('Site a'), [50, 20], [51, 21]);
    expect(screen.queryByRole('button', { name: 'Save box' })).toBeNull();
  });

  it('does the whole job by keyboard: create, move, resize, choose, save, delete', async () => {
    refs = [ref('a')];
    patch.mockResolvedValue({ markup: { id: 'm1', reference_id: 'a', asset_id: 'a-df', rect: { x: 0.37, y: 0.34, w: 0.31, h: 0.2 }, sentiment: 'dislike', category: 'colour', note: 'Too loud', deleted: false } });
    post.mockResolvedValue({ markup: { id: 'm1', reference_id: 'a', asset_id: 'a-df', rect: { x: 0.37, y: 0.34, w: 0.31, h: 0.2 }, sentiment: 'dislike', category: 'colour', note: 'Too loud', deleted: false } });
    mount();
    await screen.findByText('Site a');
    fireEvent.click(within(card('Site a')).getAllByRole('button', { name: /Add a markup box on the desktop/i })[0]);
    const box = await screen.findByTestId('markup-box');
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.getAttribute('data-rect')).toBe('0.35,0.35,0.3,0.2');
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowRight', shiftKey: true });
    expect(box.getAttribute('data-rect')).toBe('0.37,0.34,0.31,0.2');
    expect(screen.getAllByRole('status').map((s) => s.textContent).join(' ')).toMatch(/37 percent from the left and 34 percent from the top, 31 percent wide/);
    fireEvent.click(screen.getByLabelText('Dislike'));
    fireEvent.click(screen.getByLabelText('Colour'));
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Too loud' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save box' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/design/sessions/${S}/markups`, { reference_id: 'a', asset_id: 'a-df', rect: { x: 0.37, y: 0.34, w: 0.31, h: 0.2 }, sentiment: 'dislike', category: 'colour', note: 'Too loud' }));

    // The saved box can be focused, moved and saved again, then deleted, with keys and buttons only.
    const saved = await screen.findByRole('button', { name: /Markup box 1: Dislike, Colour/ });
    saved.focus();
    fireEvent.keyDown(saved, { key: 'ArrowDown' });
    fireEvent.click(screen.getByRole('button', { name: 'Save box' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/design/sessions/${S}/markups/m1`, { rect: { x: 0.37, y: 0.35, w: 0.31, h: 0.2 }, sentiment: 'dislike', category: 'colour', note: 'Too loud' }));
    patch.mockResolvedValue({ markup: { id: 'm1', reference_id: 'a', asset_id: 'a-df', rect: { x: 0.37, y: 0.35, w: 0.31, h: 0.2 }, sentiment: 'dislike', category: 'colour', note: 'Too loud', deleted: true } });
    const again = await screen.findByRole('button', { name: /Markup box 1/ });
    fireEvent.keyDown(again, { key: 'Enter' });
    fireEvent.click(screen.getByRole('button', { name: 'Delete box' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith(`/design/sessions/${S}/markups/m1`, { deleted: true }));
    await waitFor(() => expect(screen.queryByTestId('markup-box')).toBeNull());
  });

  it('shows sentiment in words and icon, and keeps Save off until both choices are made', async () => {
    mount();
    await screen.findByText('Site a');
    fireEvent.click(within(card('Site a')).getAllByRole('button', { name: /Add a markup box/ })[0]);
    const save = await screen.findByRole('button', { name: 'Save box' });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Note'));
    expect((save as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Tone'));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId('markup-box').textContent).toContain('Note');
  });

  it('holds the note to 500 characters and counts them', async () => {
    mount();
    await screen.findByText('Site a');
    fireEvent.click(within(card('Site a')).getAllByRole('button', { name: /Add a markup box/ })[0]);
    const note = (await screen.findByLabelText('Note (optional)')) as HTMLTextAreaElement;
    expect(note.getAttribute('maxlength')).toBe('500');
    expect(screen.getByTestId('note-count').textContent).toBe('0 of 500 characters');
    fireEvent.change(note, { target: { value: 'x'.repeat(650) } });
    expect(note.value.length).toBe(500);
    expect(screen.getByTestId('note-count').textContent).toBe('500 of 500 characters');
  });
});
