import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import * as React from 'react';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

const setSelectMode = vi.fn();
vi.mock('@/lib/hooks/use-design-bridge', () => ({
  useDesignBridge: () => ({ selectMode: false, setSelectMode, path: null }),
}));

import { PreviewPane, PREVIEW_SANDBOX } from '../PreviewPane';
import { TimerPill, formatElapsed } from '../TimerPill';
import { Workspace, previewState } from '../Workspace';
import { resolvePreviewUrl } from '@/lib/design/preview-path';
import type { DesignFeedResponse, DesignSessionResponse } from '@/lib/hooks/use-design';

const PREVIEW = 'https://vcdp-abc.pages.dev';

function pane(over: Partial<React.ComponentProps<typeof PreviewPane>> = {}) {
  const ref = React.createRef<HTMLIFrameElement>();
  return render(
    <PreviewPane previewUrl={PREVIEW} status="active" iframeRef={ref} selectMode={false} onSelectModeChange={setSelectMode} {...over} />,
  );
}
const iframe = () => document.querySelector('iframe') as HTMLIFrameElement;
const submitPath = (text: string) => {
  fireEvent.change(screen.getByLabelText('Preview path'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Go' }));
};

beforeEach(() => setSelectMode.mockClear());

describe('preview iframe', () => {
  it('has exactly the D7 sandbox and starts on the preview host', () => {
    pane();
    expect(iframe().getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
    expect(PREVIEW_SANDBOX).toBe('allow-scripts allow-same-origin');
    expect(new URL(iframe().src).origin).toBe(PREVIEW);
  });

  it.each(['//evil.example/x', 'https://evil.example/', 'javascript:alert(1)', '/\\evil.example', 'data:text/html,hi'])(
    'refuses a hostile path %s and the iframe stays on the preview host',
    (hostile) => {
      expect(resolvePreviewUrl(PREVIEW, hostile)).toBeNull();
      pane();
      submitPath(hostile);
      expect(new URL(iframe().src).origin).toBe(PREVIEW);
      expect(iframe().src).toBe(`${PREVIEW}/`);
      expect(screen.getByRole('alert').textContent).toContain('vcdp-abc.pages.dev');
    },
  );

  it('accepts a path and a full URL on the preview host', () => {
    pane();
    submitPath('/about?x=1');
    expect(iframe().src).toBe(`${PREVIEW}/about?x=1`);
    submitPath(`${PREVIEW}/contact`);
    expect(iframe().src).toBe(`${PREVIEW}/contact`);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('sets the wrapper width for each viewport', () => {
    pane();
    const wrapper = screen.getByTestId('preview-frame-wrapper');
    expect(wrapper.style.width).toBe('100%');
    for (const [label, width] of [['390', '390px'], ['768', '768px'], ['1280', '1280px'], ['Fit', '100%']] as const) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(wrapper.style.width).toBe(width);
    }
  });

  it('S toggles select, Esc turns it off, typing in the bar does not', () => {
    const { rerender } = pane();
    fireEvent.keyDown(window, { key: 's' });
    expect(setSelectMode).toHaveBeenLastCalledWith(true);
    fireEvent.keyDown(screen.getByLabelText('Preview path'), { key: 's' });
    expect(setSelectMode).toHaveBeenCalledTimes(1);
    rerender(<PreviewPane previewUrl={PREVIEW} status="active" iframeRef={React.createRef()} selectMode onSelectModeChange={setSelectMode} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(setSelectMode).toHaveBeenLastCalledWith(false);
  });

  it('shows setup progress while pending and no iframe', () => {
    pane({ previewUrl: null, status: 'pending' });
    expect(screen.getByText('Setting up your preview')).toBeTruthy();
    expect(iframe()).toBeNull();
  });

  it('shows the publishing overlay while publishing', () => {
    pane({ status: 'publishing' });
    expect(screen.getByTestId('publishing-overlay')).toBeTruthy();
  });
});

describe('TimerPill', () => {
  it('formats elapsed_s', () => {
    expect(formatElapsed(4320)).toBe('1h 12m');
    expect(formatElapsed(720)).toBe('12m');
    expect(formatElapsed(59)).toBe('0m');
    render(<TimerPill timer={{ running: true, elapsed_s: 4320 }} />);
    expect(screen.getByTestId('timer-pill').textContent).toBe('On this quest: 1h 12m');
  });
  it('renders nothing when timer is null or idle at zero', () => {
    const a = render(<TimerPill timer={null} />);
    expect(a.container.innerHTML).toBe('');
    const b = render(<TimerPill timer={{ running: false, elapsed_s: 0 }} />);
    expect(b.container.innerHTML).toBe('');
  });
});

const base = (over: Partial<DesignSessionResponse['session']> = {}): DesignSessionResponse => ({
  session: {
    id: 's1', task_id: 't1', site_id: 'st', project_id: null, designer_id: 'd', status: 'active', stale: false,
    preview_url: PREVIEW, preview_sha: 'aaa', head_sha: 'aaa', base_sha: 'b', cost_usd: 0, budget_usd: 5,
    live_text: null, live_action: null, last_seq: 0, publish_requested_at: null, last_publish_id: null, ...over,
  },
  task: { id: 't1', title: 'Hero copy', description: null, requirements: null },
  site: { name: 'vcdp.org' },
  pins: [], changes: [], worker: { online: true, paused: false, last_heartbeat_at: null },
});

describe('Workspace header', () => {
  it('compares head_sha and preview_sha', () => {
    expect(previewState({ preview_url: PREVIEW, preview_sha: 'a', head_sha: 'a' })).toBe('up_to_date');
    expect(previewState({ preview_url: PREVIEW, preview_sha: 'a', head_sha: 'b' })).toBe('out_of_date');
    expect(previewState({ preview_url: null, preview_sha: null, head_sha: 'b' })).toBe('building');
    expect(previewState({ preview_url: PREVIEW, preview_sha: null, head_sha: 'b' })).toBe('building');
  });

  it('renders title, site, chip, preview text with link, disabled publish and tabs', () => {
    render(<Workspace data={base()} feed={undefined} />);
    expect(screen.getByText('Hero copy')).toBeTruthy();
    expect(screen.getByText('vcdp.org')).toBeTruthy();
    expect(screen.getByTestId('status-chip').textContent).toBe('Working');
    const state = screen.getByTestId('preview-state');
    expect(state.textContent).toContain('Preview up to date');
    expect(within(state).getByRole('link').getAttribute('href')).toBe(PREVIEW);
    expect((screen.getByRole('button', { name: 'Publish to live...' }) as HTMLButtonElement).disabled).toBe(true);
    for (const t of ['Chat', 'Tray', 'Changes', 'Versions', 'Client files']) expect(screen.getByRole('tab', { name: t })).toBeTruthy();
    expect(screen.getByText(/coming in W6\.4/)).toBeTruthy();
  });

  it.each([
    ['pending', 'Setting up'], ['active', 'Working'], ['awaiting_input', 'Waiting on you'], ['paused_budget', 'Paused: budget'],
    ['stopped', 'Stopped'], ['publishing', 'Publishing'], ['closed', 'Closed'],
  ])('status chip %s', (status, label) => {
    render(<Workspace data={base({ status })} feed={undefined} />);
    expect(screen.getByTestId('status-chip').textContent).toBe(label);
  });

  it('feed overrides the loaded session: out of date, timer shown', () => {
    const feed = { status: 'active', preview_url: PREVIEW, preview_sha: 'aaa', head_sha: 'bbb', timer: { running: true, elapsed_s: 4320 }, live: { text: null, action: null } } as unknown as DesignFeedResponse;
    render(<Workspace data={base()} feed={feed} />);
    expect(screen.getByTestId('preview-state').textContent).toContain('Preview out of date');
    expect(screen.getByTestId('timer-pill').textContent).toContain('1h 12m');
  });

  it('shows "Preview building..." with no link while pending', () => {
    render(<Workspace data={base({ status: 'pending', preview_url: null, preview_sha: null, head_sha: null })} feed={undefined} />);
    const state = screen.getByTestId('preview-state');
    expect(state.textContent).toBe('Preview building...');
    expect(within(state).queryByRole('link')).toBeNull();
  });
});
