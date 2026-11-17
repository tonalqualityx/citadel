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
  id, source: 'bast_pick', role: 'inspiration', figma: null, url: `https://${id}.example.com/`, title: `Site ${id}`, why_md: 'It has a calm grid.', decision: 'pending', decision_note: null,
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
  refs = [];
  get.mockReset().mockImplementation(async () => ({ references: refs }));
  post.mockReset();
  patch.mockReset().mockResolvedValue({ reference: {} });
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

const none = { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null };
const figmaRef = (id: string, over: Record<string, unknown> = {}) => ref(id, { source: 'designer_figma', role: 'design_file', url: `https://www.figma.com/design/${id}`, title: `Figma ${id}`, why_md: null, captures: { ...none, desktop_fold: A(`${id}-df`) }, figma: { file_name: 'UI Kit', page: 'Home', frame_name: 'Home desktop', width: 1440, height: 900, frames_total: 1, frames_imported: 1 }, ...over });
const card = (title: string) => screen.getByRole('heading', { name: title }).closest('li') as HTMLElement;

describe('the Board shows design files only', () => {
  it('has the Figma field, the upload control and no Add a site', async () => {
    mount();
    await screen.findByText('Nothing here yet. Paste a Figma link or upload your designs to start.');
    expect(screen.getByLabelText('Add a Figma link')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add from Figma' })).toBeTruthy();
    expect(screen.getByText("Paste a link to a frame, a page or a whole file. The file has to be shared with Indelible's Figma account.")).toBeTruthy();
    expect(screen.getByLabelText('Choose files to upload')).toBeTruthy();
    expect(screen.queryByLabelText('Add a site')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add site' })).toBeNull();
  });

  it('refuses a site address in the Figma field and sends nothing', async () => {
    mount();
    const input = await screen.findByLabelText('Add a Figma link');
    for (const bad of ['https://example.com/design/abc', 'https://figma.com.evil.example/design/abcdefghij', 'http://www.figma.com/design/abcdefghij', 'nonsense']) {
      fireEvent.change(input, { target: { value: bad } });
      fireEvent.click(screen.getByRole('button', { name: 'Add from Figma' }));
      expect((await screen.findByRole('alert')).textContent).toBe('That is not a Figma link. Sites go on the Inspiration tab.');
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('posts a Figma link with expect figma and shows the card bringing it in', async () => {
    post.mockResolvedValueOnce({ reference: figmaRef('n', { capture_status: 'queued', captures: none, figma: null, title: 'Figma design' }) });
    mount();
    fireEvent.change(await screen.findByLabelText('Add a Figma link'), { target: { value: ' https://www.figma.com/design/abcdefghij1/Kit?node-id=1-2 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add from Figma' }));
    await screen.findByText('Figma design');
    expect(post).toHaveBeenCalledWith(`/design/sessions/${S}/references`, { url: 'https://www.figma.com/design/abcdefghij1/Kit?node-id=1-2', expect: 'figma' });
    expect(within(card('Figma design')).getByTestId('capture-chip').textContent).toBe('Bringing it in');
    expect(card('Figma design').textContent).toContain('From your Figma file');
    expect(screen.getAllByRole('status').map((x) => x.textContent).join(' ')).toContain('Your Figma design is on the board. Bringing in the frames now.');
  });

  it("shows the server's sentence for not_figma and bad_figma_link", async () => {
    post.mockRejectedValueOnce(new Error('That Figma link does not point at a design file. In Figma, right-click a frame, choose Copy link, and paste that.'));
    mount();
    fireEvent.change(await screen.findByLabelText('Add a Figma link'), { target: { value: 'https://www.figma.com/board/abcdefghij1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add from Figma' }));
    expect((await screen.findByRole('alert')).textContent).toContain('does not point at a design file');
  });

  it('a Figma card shows its source words, picture, what was read, Open in Figma and Ready', async () => {
    refs = [figmaRef('a')];
    mount();
    await screen.findByText('Figma a');
    const c = card('Figma a');
    expect(c.textContent).toContain('From your Figma file');
    expect(within(c).getAllByRole('img')).toHaveLength(1);
    expect(within(c).getByTestId('figma-line').textContent).toBe('Home desktop - 1440 x 900');
    expect(within(c).getByTestId('capture-chip').textContent).toBe('Ready');
    const link = within(c).getByRole('link', { name: /Open in Figma/ });
    expect(link.getAttribute('href')).toBe('https://www.figma.com/design/a');
    expect(link.getAttribute('target')).toBe('_blank');
    // One picture fills the row: no empty grid cell.
    expect(c.querySelectorAll('.grid > div:empty').length).toBe(0);
  });

  it('says how many frames came in when the link held more', async () => {
    refs = [figmaRef('a', { figma: { file_name: 'UI Kit', page: 'Home', frame_name: 'Home desktop', width: 1440, height: 900, frames_total: 9, frames_imported: 4 } })];
    mount();
    await screen.findByText('Figma a');
    expect(within(card('Figma a')).getByTestId('figma-line').textContent).toContain('Showing the first 4 of 9 frames. Paste a link to a single frame to add another.');
  });

  it('a failed Figma card shows the stored sentence', async () => {
    refs = [figmaRef('a', { capture_status: 'failed', capture_error: 'That file is not shared with Indelible.', captures: none, figma: null })];
    mount();
    await screen.findByText('Figma a');
    expect(within(card('Figma a')).getByTestId('capture-sentence').textContent).toBe('That file is not shared with Indelible.');
    expect(within(card('Figma a')).getByTestId('capture-chip').textContent).toBe('Could not bring in');
  });

  it('markup and Yes work on a Figma card', async () => {
    refs = [figmaRef('a')];
    mount();
    await screen.findByText('Figma a');
    fireEvent.click(within(card('Figma a')).getByRole('button', { name: /^Yes/ }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/design/sessions/${S}/references/a`, { decision: 'yes' }));
    expect(within(card('Figma a')).getAllByRole('button', { name: /Add a markup box/ }).length).toBeGreaterThan(0);
  });

  it('never shows a site, and sites do not count as board cards', async () => {
    refs = [ref('s'), figmaRef('a')];
    mount();
    await screen.findByText('Figma a');
    expect(screen.queryByText('Site s')).toBeNull();
  });

  it('counts uploads across all cards for the 100 limit, even on the Inspiration side', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    refs = [ref('s', { uploads: Array.from({ length: 100 }, (_, i) => ({ asset: A(`m${i}`, { kind: 'upload' }), renders: [] })) })];
    mount();
    const f = new File(['x'], 'one.png', { type: 'image/png' });
    await waitFor(() => expect(screen.queryByText('Loading the board.')).toBeNull());
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [f] } });
    expect((await screen.findAllByTestId('upload-row'))[0].textContent).toContain('100 uploads');
    expect(fetchMock).not.toHaveBeenCalled();
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
    post.mockResolvedValueOnce({ reference: ref('u', { source: 'designer_upload', role: 'design_file', url: null, title: 'shot.png', why_md: null, capture_status: 'none', captures: { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null }, uploads: [{ asset: A('up1', { kind: 'upload', status: 'ready' }), renders: [] }] }) });
    mount();
    await screen.findByLabelText('Choose files to upload');
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
    await screen.findByLabelText('Choose files to upload');
    fireEvent.drop(screen.getByTestId('board-drop-zone'), { dataTransfer: { files: [file('d.pdf', 'application/pdf')], types: ['Files'] } });
    await waitFor(() => expect(screen.getAllByTestId('upload-row')[0].textContent).toContain('This track already has 100 uploads'));
    expect(post).not.toHaveBeenCalled();
  });

  it('refuses a wrong type and an oversize file before any request', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mount();
    await screen.findByLabelText('Choose files to upload');
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
    refs = [ref('many', { source: 'designer_upload', role: 'design_file', url: null, uploads: Array.from({ length: 100 }, (_, i) => ({ asset: A(`m${i}`, { kind: 'upload' }), renders: [] })), captures: { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null } })];
    mount();
    await screen.findByText('Site many');
    fireEvent.change(screen.getByLabelText('Choose files to upload'), { target: { files: [file('one.png', 'image/png')] } });
    expect((await screen.findAllByTestId('upload-row'))[0].textContent).toContain('100 uploads');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['too_many_pixels', 'pdf_failed', 'not_an_image', 'svg_refused'] as const)('shows the sentence, never the code, for %s', async (code) => {
    refs = [ref('r', { source: 'designer_upload', role: 'design_file', url: null, title: 'bad.png', why_md: null, capture_status: 'none', captures: { desktop_fold: null, desktop_full: null, phone_fold: null, phone_full: null }, uploads: [{ asset: A('r1', { kind: 'upload', status: 'rejected', reject_reason: code, url: null }), renders: [] }] })];
    mount();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(UPLOAD_REJECT_SENTENCES[code]);
    expect(alert.textContent).not.toContain(code);
  });
});

