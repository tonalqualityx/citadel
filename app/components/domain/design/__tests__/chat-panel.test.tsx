import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
const toast = vi.hoisted(() => ({ apiError: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: toast }));

import { ChatPanel } from '../ChatPanel';
import { BudgetDialog } from '../BudgetDialog';
import { SteeringInput } from '../SteeringInput';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const T = '2026-10-28T10:00:00Z';
const e = (seq: number, kind: string, payload: unknown, role = 'assistant') => ({ seq, role, kind, payload, created_at: T });

function feed(over: Record<string, unknown> = {}, events: ReturnType<typeof e>[] = []) {
  return {
    events,
    live: { text: null, action: null },
    status: 'active',
    stale: false,
    publish: { can_publish: false, main_role: 'preview', precheck: null },
    timer: null,
    cost_usd: 1.5,
    budget_usd: 5,
    preview_url: null,
    preview_sha: null,
    head_sha: null,
    last_heartbeat_at: null, // idle sessions carry no session heartbeat
    worker_last_heartbeat_at: new Date().toISOString(),
    worker_online: true,
    next_poll_ms: 1500,
    last_seq: events.length ? events[events.length - 1].seq : 0,
    has_more: false,
    ...over,
  };
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  post.mockResolvedValue({});
});

describe('ChatPanel events', () => {
  it('renders each event kind', async () => {
    get.mockResolvedValue(
      feed({ live: { text: 'Drafting the hero copy', action: 'Editing home.njk' } }, [
        e(1, 'text', { text: 'Make the hero bolder' }, 'designer'),
        e(2, 'text', { text: 'On it.' }),
        e(3, 'action', { tool: 'Read', label: 'Reading home.njk', tool_use_id: 't1' }),
        e(4, 'result', { tool: 'Read', tool_use_id: 't1', ok: true, summary: '40 lines' }),
        e(5, 'screenshot', { asset_ids: ['a1', 'a2'], widths: [390, 1280], purpose: 'after' }),
        e(6, 'gate', { gates: [{ name: 'axe', ok: true, summary: '0 violations' }, { name: 'links', ok: false, summary: '2 broken', log_asset_id: 'g1' }], blocking: true }),
        e(7, 'plan', { items: [{ text: 'Rewrite hero', status: 'completed' }, { text: 'Check mobile', status: 'in_progress' }] }),
        e(8, 'cost', { turn_usd: 0.42, total_usd: 1.5, budget_usd: 5 }),
        e(9, 'status', { text: 'Preview rebuilt' }),
        e(10, 'followup', { task_id: 'tk', title: 'Fix About page' }),
        e(11, 'client_files', { folder_id: 'f', items: [{ id: '1' }, { id: '2' }, { id: '3' }] }),
        e(12, 'publish', { publish_id: 'p1', kind: 'publish', status: 'published', summary: 'Live at vcdp.org' }),
      ]),
    );
    wrap(<ChatPanel sessionId="s1" />);
    expect(await screen.findByText('Make the hero bolder')).toBeTruthy();
    expect(screen.getByText('On it.')).toBeTruthy();
    expect(screen.getByText('Read home.njk')).toBeTruthy();
    expect(screen.getByText(/40 lines/)).toBeTruthy();
    const imgs = document.querySelectorAll('[data-testid="screenshots"] img');
    expect(imgs).toHaveLength(2);
    expect((imgs[0] as HTMLImageElement).getAttribute('src')).toBe('/api/design/sessions/s1/assets/a1');
    expect(screen.getByText('1 of 2 gates failed')).toBeTruthy();
    expect(screen.getByText('Blocks publishing')).toBeTruthy();
    expect(screen.getByText('Plan (1 of 2 done)')).toBeTruthy();
    expect(screen.getByText('Check mobile')).toBeTruthy();
    expect(screen.getByTestId('status-line').textContent).toBe('Preview rebuilt');
    expect(screen.getByTestId('followup-chip').textContent).toBe('Fix About page');
    expect(screen.getByTestId('client-files-line').textContent).toContain('3 items');
    expect(screen.getByTestId('publish-event').textContent).toContain('Live at vcdp.org');
    expect(screen.getByTestId('live-line').textContent).toContain('Drafting the hero copy');
    expect(screen.getByTestId('live-line').textContent).toContain('Editing home.njk');
    expect(screen.getByTestId('last-turn').textContent).toContain('$0.42');
    expect(screen.getByText('$1.50')).toBeTruthy();
  });

  it('expands gate output from the log asset', async () => {
    get.mockResolvedValue(feed({}, [e(1, 'gate', { gates: [{ name: 'links', ok: false, log_asset_id: 'g1' }], blocking: false })]));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => 'broken: /about' });
    vi.stubGlobal('fetch', fetchMock);
    wrap(<ChatPanel sessionId="s1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Output/ }));
    expect((await screen.findByTestId('gate-output')).textContent).toBe('broken: /about');
    expect(fetchMock.mock.calls[0][0]).toBe('/api/design/sessions/s1/assets/g1');
    vi.unstubAllGlobals();
  });

  it('pages from after=0 and follows has_more', async () => {
    get
      .mockResolvedValueOnce(feed({ has_more: true }, [e(1, 'text', { text: 'one' }), e(2, 'text', { text: 'two' })]))
      .mockResolvedValue(feed({}, [e(3, 'text', { text: 'three' })]));
    wrap(<ChatPanel sessionId="s1" />);
    expect(await screen.findByText('three')).toBeTruthy();
    expect(screen.getByText('one')).toBeTruthy();
    expect(get.mock.calls[0][1].params.after).toBe(0);
    expect(get.mock.calls[1][1].params.after).toBe(2);
  });
});

describe('Stop and steering', () => {
  it('Stop is disabled when nothing runs and enabled when active', async () => {
    get.mockResolvedValue(feed({ status: 'awaiting_input' }));
    const { unmount } = wrap(<ChatPanel sessionId="s1" />);
    const stopIdle = await screen.findByRole('button', { name: /Stop/ });
    expect((stopIdle as HTMLButtonElement).disabled).toBe(true);
    unmount();

    get.mockResolvedValue(feed({ status: 'active' }));
    wrap(<ChatPanel sessionId="s1" />);
    const stop = await screen.findByRole('button', { name: /Stop/ });
    expect((stop as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(stop);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/design/sessions/s1/stop', {}));
  });

  it('posts a uuid client_ref and clears the box', async () => {
    wrap(<SteeringInput sessionId="s1" status="active" />);
    const box = screen.getByLabelText('Message to the design worker') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: '  Make it blue  ' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('/design/sessions/s1/messages');
    expect(body.text).toBe('Make it blue');
    expect(body.client_ref).toMatch(UUID);
    await waitFor(() => expect(box.value).toBe(''));

    fireEvent.change(box, { target: { value: 'Again' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
    expect(post.mock.calls[1][1].client_ref).not.toBe(body.client_ref);
  });

  it('sends the page context with a plain message and shows it under the input', async () => {
    wrap(<SteeringInput sessionId="s1" status="active" view={{ path: '/about/', width: 1280, previewSha: 'abc1234' }} />);
    expect(screen.getByTestId('page-context').textContent).toBe('On /about/ at 1280');
    expect(screen.getByPlaceholderText('Describe the changes for this page. Select an element only if it helps.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Message to the design worker'), { target: { value: 'Bigger hero' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({ text: 'Bigger hero', context: { path: '/about/', viewport_w: 1280, preview_sha: 'abc1234' } });
  });

  it('sends no context (and no line) when the page is unknown or invalid', async () => {
    wrap(<SteeringInput sessionId="s1" status="active" view={{ path: null, width: 1280 }} />);
    expect(screen.queryByTestId('page-context')).toBeNull();
    fireEvent.change(screen.getByLabelText('Message to the design worker'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).not.toHaveProperty('context');
  });

  it('keeps the text and toasts when sending fails', async () => {
    post.mockRejectedValue(new Error('nope'));
    wrap(<SteeringInput sessionId="s1" status="awaiting_input" />);
    const box = screen.getByLabelText('Message to the design worker') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(toast.apiError).toHaveBeenCalled());
    expect(box.value).toBe('hello');
  });

  it('is disabled when the session is closed', () => {
    wrap(<SteeringInput sessionId="s1" status="closed" />);
    expect((screen.getByLabelText('Message to the design worker') as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: /Send/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('BudgetDialog', () => {
  it('refuses a non-raise without calling the server', () => {
    wrap(<BudgetDialog sessionId="s1" currentBudget={5} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('New ceiling (USD)'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect(screen.getByRole('alert').textContent).toContain('above the current $5.00');
    expect(post).not.toHaveBeenCalled();
  });

  it('shows the server cap error', async () => {
    post.mockRejectedValue(new Error('You can raise this session to at most $50'));
    wrap(<BudgetDialog sessionId="s1" currentBudget={5} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByLabelText('New ceiling (USD)'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
    expect((await screen.findByRole('alert')).textContent).toContain('at most $50');
    expect(post).toHaveBeenCalledWith('/design/sessions/s1/budget', { budget_usd: 80 });
  });

  it('raises and closes on success', async () => {
    const onOpenChange = vi.fn();
    wrap(<BudgetDialog sessionId="s1" currentBudget={5} open onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByLabelText('New ceiling (USD)'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'Raise' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalled();
  });
});

describe('worker-silent banner', () => {
  it('shows when the worker is offline on a live session', async () => {
    get.mockResolvedValue(feed({ status: 'awaiting_input', worker_online: false }));
    wrap(<ChatPanel sessionId="s1" />);
    expect(await screen.findByTestId('worker-silent')).toBeTruthy();
  });

  it('stays hidden for an idle session with a null session heartbeat while the worker is online', async () => {
    get.mockResolvedValue(feed({ status: 'awaiting_input' }));
    wrap(<ChatPanel sessionId="s1" />);
    await screen.findByTestId('chat-panel');
    expect(screen.queryByTestId('worker-silent')).toBeNull();
  });

  it('pending over 60 s with the worker online shows the setup hint, not "gone quiet"', async () => {
    get.mockResolvedValue(feed({ status: 'pending' }));
    wrap(<ChatPanel sessionId="s1" createdAt={new Date(Date.now() - 90_000).toISOString()} />);
    expect((await screen.findByTestId('setup-slow')).textContent).toContain('first build takes a few minutes');
    expect(screen.queryByTestId('worker-silent')).toBeNull();
  });

  it('pending over 60 s with the worker offline shows the quiet banner', async () => {
    get.mockResolvedValue(feed({ status: 'pending', worker_online: false }));
    wrap(<ChatPanel sessionId="s1" createdAt={new Date(Date.now() - 90_000).toISOString()} />);
    expect(await screen.findByTestId('worker-silent')).toBeTruthy();
    expect(screen.queryByTestId('setup-slow')).toBeNull();
  });
});

describe('gate and tool rendering', () => {
  it('shows one compact summary for a run of passing gates, details behind the toggle, no Blocks badge', async () => {
    const names = ['build', 'library', 'forms', 'responsive', 'accessibility', 'preview', 'balance_check'];
    get.mockResolvedValue(feed({}, names.map((n, i) => e(i + 1, 'gate', { gates: [{ name: n, ok: true, summary: 'fine' }], blocking: true }))));
    wrap(<ChatPanel sessionId="s1" />);
    const card = await screen.findByTestId('gate-summary');
    expect(document.querySelectorAll('[data-testid="gate-summary"]')).toHaveLength(1);
    expect(card.textContent).toContain('Checks passed: build, library, forms, responsive, accessibility, preview, balance_check (report only)');
    expect(screen.queryByText('Blocks publishing')).toBeNull();
    expect(screen.queryByText('All gates passed')).toBeNull();
  });

  it('a red blocking gate stays a prominent card with the badge', async () => {
    get.mockResolvedValue(feed({}, [e(1, 'gate', { gates: [{ name: 'build', ok: true }] }), e(2, 'gate', { gates: [{ name: 'forms', ok: false, summary: 'no label' }] })]));
    wrap(<ChatPanel sessionId="s1" />);
    expect(await screen.findByText('1 of 2 gates failed')).toBeTruthy();
    expect(screen.getByText('Blocks publishing')).toBeTruthy();
  });

  it('a failed report-only gate does not block', async () => {
    get.mockResolvedValue(feed({}, [e(1, 'gate', { gates: [{ name: 'build', ok: true }] }), e(2, 'gate', { gates: [{ name: 'balance_check', ok: false, summary: 'uneven' }] })]));
    wrap(<ChatPanel sessionId="s1" />);
    await screen.findByTestId('gate-summary');
    expect(screen.queryByText('Blocks publishing')).toBeNull();
  });

  it('renders a huge tool result as one line with the raw output behind Details, capped at 40 lines', async () => {
    const body = Array.from({ length: 300 }, (_, i) => `${i + 1}: registry row`).join('\n');
    get.mockResolvedValue(feed({}, [
      e(1, 'action', { tool: 'Grep', label: 'Searching registry.json', tool_use_id: 'a' }),
      e(2, 'result', { tool: 'Grep', tool_use_id: 'a', ok: true, summary: body }),
    ]));
    wrap(<ChatPanel sessionId="s1" />);
    const line = await screen.findByTestId('tool-line');
    expect(line.textContent).toContain('1: registry row (+299 more lines)');
    const pre = line.querySelector('pre')!;
    expect(pre.textContent!.split('\n').length).toBeLessThanOrEqual(42);
    expect(pre.textContent).toContain('260 more lines not shown');
    expect(pre.textContent).not.toContain('300: registry row');
  });
});

describe('selection chip', () => {
  const draft = { id: 'draft-1', received_at: 1, draft: { path: '/about/', sha: 'abc', data_lib: 'state_card', lib_stack: ['state_card'], data_shape: null, selector: '.c', tag: 'div', classes: [], text_quote: null, bbox: { x: 0, y: 0, w: 1, h: 1 }, viewport: { w: 1280, h: 800 } } };

  it('shows one removable chip and sending creates the pin then applies with the text as the note', async () => {
    get.mockResolvedValue(feed({ status: 'awaiting_input' }));
    post.mockResolvedValue({ pin: { id: 'pin-9' } });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201, json: async () => ({ seq: 3 }) });
    vi.stubGlobal('fetch', fetchMock);
    const onClear = vi.fn();
    const onSent = vi.fn();
    wrap(<ChatPanel sessionId="s1" selection={draft} onClearSelection={onClear} onSent={onSent} view={{ path: '/pricing/', width: 768 }} />);
    expect((await screen.findByTestId('selection-chip')).textContent).toContain('state_card on /about/ at 1280');
    fireEvent.change(screen.getByLabelText('Message to the design worker'), { target: { value: 'Make it bigger' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/design/sessions/s1/pins');
    expect(post.mock.calls[0][1]).toMatchObject({ note: 'Make it bigger', data_lib: 'state_card' });
    expect(post.mock.calls.some((c) => String(c[0]).endsWith('/messages'))).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/design/sessions/s1/apply');
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({ pin_ids: ['pin-9'], note: 'Make it bigger', context: { path: '/pricing/', viewport_w: 768 } });
    expect(onClear).toHaveBeenCalledWith('draft-1');
    await waitFor(() => expect(onSent).toHaveBeenCalled());
    vi.unstubAllGlobals();
  });

  it('removing the chip sends a plain message', async () => {
    get.mockResolvedValue(feed({ status: 'awaiting_input' }));
    const onClear = vi.fn();
    const { rerender } = wrap(<ChatPanel sessionId="s1" selection={draft} onClearSelection={onClear} />);
    fireEvent.click(await screen.findByRole('button', { name: /Remove selection/ }));
    expect(onClear).toHaveBeenCalledWith('draft-1');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(<QueryClientProvider client={qc}><ChatPanel sessionId="s1" selection={null} /></QueryClientProvider>);
    expect(screen.queryByTestId('selection-chip')).toBeNull();
    fireEvent.change(await screen.findByLabelText('Message to the design worker'), { target: { value: 'Just a note' } });
    fireEvent.click(screen.getByRole('button', { name: /Send/ }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(post.mock.calls[0][0]).toBe('/design/sessions/s1/messages');
    expect(post.mock.calls[0][1]).toMatchObject({ text: 'Just a note' });
  });

  it('without a selection there is no chip', async () => {
    get.mockResolvedValue(feed({ status: 'awaiting_input' }));
    wrap(<ChatPanel sessionId="s1" />);
    await screen.findByTestId('chat-panel');
    expect(screen.queryByTestId('selection-chip')).toBeNull();
  });
});
