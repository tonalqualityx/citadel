import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

const post = vi.fn();
const patch = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), get: (...a: unknown[]) => get(...a) },
}));
vi.mock('@/lib/hooks/use-toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() },
}));

import { ChangesTab, type ChangeView } from '../ChangesTab';
import { VersionsTab } from '../VersionsTab';
import { ClientFilesTab, driveLink } from '../ClientFilesTab';
import { WorkspaceTabs } from '../WorkspaceTabs';
import { pairAssetsByWidth } from '../BeforeAfter';

const SID = 'sess-1';
const SHA = 'aaaaaaa1111';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const fetchMock = vi.fn();
beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  get.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const jsonResponse = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

const change = (over: Partial<ChangeView> = {}): ChangeView => ({
  id: 'c1',
  commit_sha: 'abcdef1234567',
  summary: 'Bigger hero',
  files: ['a.njk'],
  data_libs: ['hero'],
  pages: ['/'],
  before_asset_ids: ['b390', 'b768', 'b1280'],
  after_asset_ids: ['a390', 'a768', 'a1280'],
  decision: 'pending',
  created_at: '2026-10-28T10:00:00Z',
  ...over,
});

describe('ChangesTab', () => {
  it('accept and deny PATCH the decision with the note', async () => {
    wrap(<ChangesTab sessionId={SID} changes={[change()]} events={[]} />);
    fireEvent.change(screen.getByLabelText('Note on this change'), { target: { value: 'Too tall' } });
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/changes/c1', { decision: 'denied', note: 'Too tall' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(patch).toHaveBeenLastCalledWith('/design/changes/c1', { decision: 'accepted', note: 'Too tall' }));
  });

  it('renders before/after at 390, 768 and 1280 from the session asset route', () => {
    wrap(<ChangesTab sessionId={SID} changes={[change()]} events={[]} />);
    for (const w of ['390', '768', '1280']) expect(screen.getByRole('button', { name: w })).toBeTruthy();
    expect(screen.getByAltText('Before at 390px').getAttribute('src')).toBe(`/api/design/sessions/${SID}/assets/b390`);
    fireEvent.click(screen.getByRole('button', { name: '768' }));
    expect(screen.getByAltText('After at 768px').getAttribute('src')).toBe(`/api/design/sessions/${SID}/assets/a768`);
  });

  it('pixel diff toggle shows the count from the injected differ', async () => {
    const { BeforeAfter } = await import('../BeforeAfter');
    const diff = vi.fn().mockResolvedValue({ count: 3, width: 1, height: 1, ratio: 1, sizeMismatch: false, overlay: new Uint8ClampedArray(4) });
    wrap(<BeforeAfter sessionId={SID} pairs={[{ width: 390, beforeId: 'b', afterId: 'a' }]} diff={diff} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show pixel diff' }));
    expect((await screen.findByTestId('diff-count')).textContent).toContain('3 pixels differ');
  });

  it('pairs assets by the widths in screenshot events', () => {
    const pairs = pairAssetsByWidth(
      { before_asset_ids: ['x', 'y'], after_asset_ids: ['p', 'q'] },
      [
        { kind: 'screenshot', payload: { asset_ids: ['x', 'y'], widths: [1280, 390], purpose: 'before' } },
        { kind: 'screenshot', payload: { asset_ids: ['p', 'q'], widths: [1280, 390], purpose: 'after' } },
      ],
    );
    expect(pairs).toEqual([
      { width: 390, beforeId: 'y', afterId: 'q' },
      { width: 1280, beforeId: 'x', afterId: 'p' },
    ]);
  });
});

describe('VersionsTab', () => {
  it('Restore asks for confirmation, then POSTs to_sha', async () => {
    wrap(<VersionsTab sessionId={SID} changes={[change(), change({ id: 'c2', commit_sha: 'fedcba7654321', summary: 'Newer', created_at: '2026-10-28T11:00:00Z' })]} headSha="fedcba7654321" />);
    expect(screen.getByText('Current')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(post).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/design/sessions/${SID}/restore`, { to_sha: 'abcdef1234567' }));
  });

  it('Cancel closes the confirm without posting', async () => {
    wrap(<VersionsTab sessionId={SID} changes={[change()]} headSha={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(post).not.toHaveBeenCalled();
  });
});

describe('ClientFilesTab', () => {
  const events = [
    {
      seq: 3,
      kind: 'client_files',
      created_at: '2026-10-28T10:00:00Z',
      payload: {
        folder_id: 'F',
        items: [
          { id: 'doc1', name: 'brief.pdf', mime: 'application/pdf', modified: '2026-10-01T00:00:00Z', path: 'Docs' },
          { id: 'img1', name: 'logo.png', mime: 'image/png', webViewLink: 'https://drive.google.com/file/d/img1/view?usp=drivesdk' },
          { id: 'fold1', name: 'Photos', mime: 'application/vnd.google-apps.folder' },
        ],
      },
    },
  ];

  it('renders the empty state when no listing exists', () => {
    wrap(<ClientFilesTab sessionId={SID} events={[]} attached={[]} onAttach={vi.fn()} onDetach={vi.fn()} />);
    expect(screen.getByTestId('client-files-empty').textContent).toContain('No client folder configured');
  });

  it('Refresh posts client-files/refresh', async () => {
    wrap(<ClientFilesTab sessionId={SID} events={[]} attached={[]} onAttach={vi.fn()} onDetach={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith(`/design/sessions/${SID}/client-files/refresh`, {}));
  });

  it('lists files, links to Drive, and attaches files (folders cannot attach)', () => {
    const onAttach = vi.fn();
    wrap(<ClientFilesTab sessionId={SID} events={events} attached={[]} onAttach={onAttach} onDetach={vi.fn()} />);
    expect(screen.getAllByTestId('client-file')).toHaveLength(3);
    expect(screen.getAllByRole('button', { name: 'Attach to next Apply' })).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Open brief.pdf in Drive' }).getAttribute('href')).toBe('https://drive.google.com/file/d/doc1/view');
    expect(screen.getByRole('link', { name: 'Open logo.png in Drive' }).getAttribute('href')).toContain('usp=drivesdk');
    expect(driveLink({ id: 'x', mime: 'application/vnd.google-apps.folder' })).toBe('https://drive.google.com/drive/folders/x');
    fireEvent.click(screen.getAllByRole('button', { name: 'Attach to next Apply' })[0]);
    expect(onAttach).toHaveBeenCalledWith({ id: 'doc1', name: 'brief.pdf', mime: 'application/pdf' });
  });

  it('an attached file rides in the apply body when the chat sends a selection', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { seq: 9 }));
    post.mockResolvedValue({ pin: { id: 'pin-1' } });
    get.mockResolvedValue({ events: [], live: { text: null, action: null }, status: 'awaiting_input', stale: false, publish: { can_publish: false, main_role: 'client_preview', precheck: null }, timer: null, cost_usd: 0, budget_usd: 5, preview_url: null, preview_sha: SHA, head_sha: SHA, last_heartbeat_at: null, worker_last_heartbeat_at: null, worker_online: true, next_poll_ms: 5000, last_seq: 0, has_more: false });
    const data = {
      session: { id: SID, status: 'awaiting_input', preview_sha: SHA, head_sha: SHA, base_sha: null },
      pins: [],
      changes: [],
    } as never;
    const feed = { status: 'awaiting_input', preview_sha: SHA, head_sha: SHA, events } as never;
    const draft = { id: 'draft-1', received_at: 1, draft: { path: '/about/', sha: SHA, data_lib: 'state_card', lib_stack: [], data_shape: null, selector: '.c', tag: 'div', classes: [], text_quote: null, bbox: { x: 0, y: 0, w: 1, h: 1 }, viewport: { w: 1280, h: 800 } } };
    wrap(<WorkspaceTabs sessionId={SID} data={data} feed={feed} bridge={{ drafts: [draft], removeDraft: vi.fn() }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Attach to next Apply' })[0]);
    expect(screen.getAllByTestId('attach-chip')).toHaveLength(1);
    fireEvent.change(await screen.findByLabelText('Message to the design worker'), { target: { value: 'Use the brief copy' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.files).toEqual([{ id: 'doc1', name: 'brief.pdf', mime: 'application/pdf' }]);
    expect(body.pin_ids).toEqual(['pin-1']);
    expect(body.note).toBe('Use the brief copy');
  });
});
