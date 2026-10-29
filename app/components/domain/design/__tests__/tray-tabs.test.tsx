import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

const post = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), get: vi.fn() },
}));
vi.mock('@/lib/hooks/use-toast', () => ({
  showToast: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() },
}));

import { Tray } from '../Tray';
import { ChangesTab, type ChangeView } from '../ChangesTab';
import { VersionsTab } from '../VersionsTab';
import { ClientFilesTab, driveLink } from '../ClientFilesTab';
import { WorkspaceTabs } from '../WorkspaceTabs';
import { pairAssetsByWidth } from '../BeforeAfter';
import type { TrayPin, ClientFileRef } from '@/lib/hooks/use-design-tray';

const SID = 'sess-1';
const SHA = 'aaaaaaa1111';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const pin = (id: string, over: Partial<TrayPin> = {}): TrayPin => ({
  id,
  status: 'pending',
  note: '',
  page_path: '/about',
  data_lib: 'hero',
  lib_stack: [],
  data_shape: null,
  selector: '.hero',
  tag: 'section',
  classes: [],
  text_quote: null,
  viewport_width: 390,
  preview_sha: SHA,
  followup_task_id: null,
  ...over,
});

const baseTray = {
  sessionId: SID,
  previewSha: SHA,
  drafts: [],
  onRemoveDraft: vi.fn(),
  attachedFiles: [] as ClientFileRef[],
  onDetachFile: vi.fn(),
};

const fetchMock = vi.fn();
beforeEach(() => {
  post.mockReset().mockResolvedValue({});
  patch.mockReset().mockResolvedValue({});
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

const jsonResponse = (status: number, body: unknown) => ({ ok: status < 400, status, json: async () => body });

describe('Tray', () => {
  it('disables Apply with zero pins', () => {
    wrap(<Tray {...baseTray} pins={[]} />);
    expect((screen.getByRole('button', { name: /^Apply/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('posts apply with a uuid client_ref, the pin ids and the attached files', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { seq: 5 }));
    const files = [{ id: 'f1', name: 'brief.pdf', mime: 'application/pdf' }];
    const onApplied = vi.fn();
    wrap(<Tray {...baseTray} pins={[pin('p1'), pin('p2')]} attachedFiles={files} onApplied={onApplied} />);
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/design/sessions/${SID}/apply`);
    const body = JSON.parse(init.body);
    expect(body.pin_ids).toEqual(['p1', 'p2']);
    expect(body.files).toEqual(files);
    expect(body.client_ref).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(onApplied).toHaveBeenCalled());
  });

  it('on 409 stale_pins lists the stale pins and Remove-and-apply discards them then applies the rest', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(409, { error: 'The preview changed', code: 'stale_pins', stale_pin_ids: ['p2'] }))
      .mockResolvedValueOnce(jsonResponse(201, { seq: 6 }));
    wrap(<Tray {...baseTray} pins={[pin('p1'), pin('p2', { page_path: '/pricing', data_lib: 'price-table', preview_sha: 'old' })]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    const list = await screen.findByTestId('stale-list');
    expect(within(list).getByText('price-table on /pricing')).toBeTruthy();
    expect(within(list).queryByText('hero on /about')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove them and apply' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/pins/p2', { status: 'discarded' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).pin_ids).toEqual(['p1']);
  });

  it('Cancel on the stale dialog does not patch or re-apply', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'x', code: 'stale_pins', stale_pin_ids: ['p1'] }));
    wrap(<Tray {...baseTray} pins={[pin('p1')]} />);
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    await screen.findByTestId('stale-list');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('stale-list')).toBeNull());
    expect(patch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('Belongs to another task PATCHes status followup and never mentions approval or Mike', async () => {
    const { container, rerender } = wrap(<Tray {...baseTray} pins={[pin('p1')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Belongs to another task' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/pins/p1', { status: 'followup' }));
    expect(container.textContent).not.toMatch(/approval|approve|mike/i);

    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <Tray {...baseTray} pins={[pin('p1', { status: 'followup' })]} />
      </QueryClientProvider>,
    );
    expect(screen.getByText('Follow-up task filed')).toBeTruthy();
    expect(container.textContent).not.toMatch(/approval|approve|mike/i);
  });

  it('shows the blast-radius chip only when the data is there', () => {
    wrap(<Tray {...baseTray} pins={[pin('p1', { blast_radius: 7 }), pin('p2')]} />);
    expect(screen.getAllByText('Used on 7 pages')).toHaveLength(1);
  });

  it('turns a draft into a server pin on Add, with the note', async () => {
    const onRemoveDraft = vi.fn();
    const draft = {
      id: 'draft-1',
      received_at: 0,
      draft: {
        path: '/', sha: SHA, data_lib: 'hero', lib_stack: [], data_shape: null, selector: '.h', tag: 'h1', classes: [],
        text_quote: null, bbox: { x: 0, y: 0, w: 1, h: 1 }, viewport: { w: 390, h: 800 },
      },
    };
    wrap(<Tray {...baseTray} pins={[]} drafts={[draft]} onRemoveDraft={onRemoveDraft} />);
    fireEvent.change(screen.getByLabelText('Note for the new pin'), { target: { value: 'Bigger' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe(`/design/sessions/${SID}/pins`);
    expect(post.mock.calls[0][1]).toMatchObject({ selector: '.h', note: 'Bigger' });
    await waitFor(() => expect(onRemoveDraft).toHaveBeenCalledWith('draft-1'));
  });

  it('warns before unload while pins are pending', () => {
    wrap(<Tray {...baseTray} pins={[pin('p1')]} />);
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });
});

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

  it('attached chips ride in the apply body through WorkspaceTabs', async () => {
    fetchMock.mockResolvedValue(jsonResponse(201, { seq: 9 }));
    const data = {
      session: { id: SID, status: 'awaiting_input', preview_sha: SHA, head_sha: SHA, base_sha: null },
      pins: [pin('p1')],
      changes: [],
    } as never;
    const feed = { status: 'awaiting_input', preview_sha: SHA, head_sha: SHA, events } as never;
    wrap(<WorkspaceTabs sessionId={SID} data={data} feed={feed} bridge={{ drafts: [], removeDraft: vi.fn(), highlight: vi.fn() }} />);
    fireEvent.click(screen.getAllByRole('button', { name: 'Attach to next Apply' })[0]);
    expect(screen.getAllByTestId('attach-chip')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).files).toEqual([{ id: 'doc1', name: 'brief.pdf', mime: 'application/pdf' }]);
  });
});
