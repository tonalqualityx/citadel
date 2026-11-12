import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

vi.mock('@/lib/api/client', () => ({ apiClient: { post: vi.fn(), patch: vi.fn(), get: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../ChatPanel', () => ({ ChatPanel: () => <div>chat</div> }));
vi.mock('../TasksTab', () => ({ TasksTab: () => <div>tasks</div> }));
vi.mock('../ChangesTab', () => ({ ChangesTab: () => <div>changes</div> }));
vi.mock('../VersionsTab', () => ({ VersionsTab: () => <div>versions</div> }));
vi.mock('../ClientFilesTab', () => ({ ClientFilesTab: () => <div>files</div> }));
vi.mock('../brief/BriefTab', () => ({ BriefTab: (p: { track: { id: string } }) => <div data-testid="brief-tab">{p.track.id}</div> }));
vi.mock('../board/BoardTab', () => ({ BoardTab: () => <div data-testid="board-tab" /> }));
vi.mock('../direction/DirectionTab', () => ({ DirectionTab: () => <div data-testid="direction-tab" /> }));

import { useWorkspaceTabSlots, type WorkspaceTabsProps } from '../WorkspaceTabs';
import { designKeys } from '@/lib/hooks/use-design';

const SID = 'sess-1';
const TRACK = { id: 'trk-1', stage: 'research', busy: false, busy_line: null, preview_alias: 'design-t-abc', preview_url: null, finish: null };
const session = (track: unknown) => ({ session: { id: SID, status: 'awaiting_input', head_sha: null, base_sha: null, track }, pins: [], changes: [] }) as never;
const stageEvent = (seq: number) => ({ seq, role: 'system', kind: 'track_stage', payload: { stage: 'art_direction', busy: false, line: null }, created_at: '2026-11-10T08:00:00Z' });
const feedWith = (events: unknown[]) => ({ status: 'awaiting_input', head_sha: null, events }) as never;

function Probe(props: WorkspaceTabsProps) {
  const slots = useWorkspaceTabSlots(props);
  return (
    <div>
      <p data-testid="keys">{Object.keys(slots).sort().join(',')}</p>
      {slots.brief}
      {slots.board}
      {slots.direction}
    </div>
  );
}

function mount(props: WorkspaceTabsProps) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(qc, 'invalidateQueries').mockResolvedValue(undefined);
  const view = render(
    <QueryClientProvider client={qc}>
      <Probe {...props} />
    </QueryClientProvider>,
  );
  const rerender = (next: WorkspaceTabsProps) =>
    view.rerender(
      <QueryClientProvider client={qc}>
        <Probe {...next} />
      </QueryClientProvider>,
    );
  return { invalidate, rerender };
}

const bridge = { drafts: [], removeDraft: vi.fn() };

describe('useWorkspaceTabSlots on a design track', () => {
  it('an untracked session has exactly the v1 slots', () => {
    mount({ sessionId: SID, data: session(null), feed: feedWith([]), bridge });
    expect(screen.getByTestId('keys').textContent).toBe('changes,chat,client-files,tasks,versions');
    expect(screen.queryByTestId('brief-tab')).toBeNull();
  });

  it('a tracked session adds Brief, Board and Direction and hands them the track', () => {
    mount({ sessionId: SID, data: session(TRACK), feed: feedWith([]), bridge });
    expect(screen.getByTestId('keys').textContent).toBe('board,brief,changes,chat,client-files,direction,tasks,versions');
    expect(screen.getByTestId('brief-tab').textContent).toBe('trk-1');
    expect(screen.getByTestId('board-tab')).toBeTruthy();
    expect(screen.getByTestId('direction-tab')).toBeTruthy();
  });

  it('refetches the session once per new stage line, and not for the lines already there at load', () => {
    const base = { sessionId: SID, data: session(TRACK), bridge };
    const { invalidate, rerender } = mount({ ...base, feed: feedWith([stageEvent(3)]) });
    expect(invalidate).not.toHaveBeenCalled();
    rerender({ ...base, feed: feedWith([stageEvent(3)]) });
    expect(invalidate).not.toHaveBeenCalled();
    rerender({ ...base, feed: feedWith([stageEvent(3), stageEvent(7)]) });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: designKeys.session(SID) });
    rerender({ ...base, feed: feedWith([stageEvent(3), stageEvent(7)]) });
    expect(invalidate).toHaveBeenCalledTimes(1);
  });
});
