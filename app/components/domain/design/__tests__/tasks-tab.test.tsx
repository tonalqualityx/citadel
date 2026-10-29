import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';

const get = vi.fn();
const post = vi.fn();
const push = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a) } }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { success: vi.fn(), error: vi.fn(), apiError: vi.fn() } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { TasksTab } from '../TasksTab';
import { WORKSPACE_TABS } from '../Workspace';
import { editScopeText } from '../EditScopeLabel';
import { projectPublishPage, projectChange } from '@/lib/design/projections';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}
const task = (over: Record<string, unknown> = {}) => ({
  id: 't1', title: 'Fix the hero', status: 'in_progress', due_date: '2026-11-02T00:00:00.000Z', description: 'Make it taller',
  assignee_first_name: 'Lisa', mine: true, project: { id: 'p1', name: 'VCDP' }, ...over,
});

beforeEach(() => {
  get.mockReset().mockResolvedValue({ tasks: [task(), task({ id: 't2', title: 'Footer links', description: null, assignee_first_name: null, due_date: null, status: 'blocked' })], mine: true });
  post.mockReset().mockResolvedValue({ session: { id: 'new-session' } });
  push.mockReset();
});

describe('Tasks tab', () => {
  it('sits right after Chat', () => {
    expect(WORKSPACE_TABS.map((t) => t.id).slice(0, 2)).toEqual(['chat', 'tasks']);
  });

  it('defaults to "Assigned to me" (mine=1) and toggles to all tasks on the site', async () => {
    wrap(<TasksTab sessionId="s1" />);
    await screen.findByText('Fix the hero');
    expect(get).toHaveBeenLastCalledWith('/design/sessions/s1/site-tasks', { params: { mine: '1' } });
    expect(screen.getByRole('button', { name: 'Assigned to me' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'All on this site' }));
    await waitFor(() => expect(get).toHaveBeenLastCalledWith('/design/sessions/s1/site-tasks', undefined));
    expect(screen.getByRole('button', { name: 'All on this site' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('a row shows title, status, due date, assignee first name and project; click expands the description', async () => {
    wrap(<TasksTab sessionId="s1" />);
    const row = (await screen.findAllByTestId('site-task'))[0];
    expect(row.textContent).toContain('In progress');
    expect(row.textContent).toContain('Due Nov 2');
    expect(row.textContent).toContain('Lisa');
    expect(row.textContent).toContain('VCDP');
    expect(screen.queryByText('Make it taller')).toBeNull();
    fireEvent.click(row.querySelector('button')!);
    expect(screen.getByText('Make it taller')).toBeTruthy();
  });

  it('"Work on this" opens the task\'s session and navigates to it; the current task has no button', async () => {
    wrap(<TasksTab sessionId="s1" currentTaskId="t1" />);
    const rows = await screen.findAllByTestId('site-task');
    fireEvent.click(rows[0].querySelector('button')!);
    expect(screen.queryByRole('button', { name: 'Work on this' })).toBeNull();
    fireEvent.click(rows[1].querySelector('button')!);
    fireEvent.click(screen.getByRole('button', { name: 'Work on this' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/design/sessions', { task_id: 't2' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/design/s/new-session'));
  });

  it('says so when there is nothing', async () => {
    get.mockResolvedValue({ tasks: [], mine: true });
    wrap(<TasksTab sessionId="s1" />);
    expect(await screen.findByText('Nothing assigned to you on this site.')).toBeTruthy();
  });
});

describe('edit scope', () => {
  it('label text', () => {
    expect(editScopeText('instance', 5)).toBe('This instance');
    expect(editScopeText('component', 19)).toBe('Component: 19 places');
    expect(editScopeText('component', null)).toBe('Component');
    expect(editScopeText(null, 3)).toBeNull();
  });
  it('the session change projection and the publish page projection carry edit_scope', () => {
    const base = { id: 'c', summary: 's', data_libs: [], pages: [], before_asset_ids: [], after_asset_ids: [], decision: 'pending' };
    const page = projectPublishPage({ publish: {} as never, session: { id: 's', task: { id: 't', title: 'T' }, designer: { name: 'D' } }, changes: [{ ...base, edit_scope: 'component', render_count: 19 }], rollback: { ok: true } } as never) as never as { changes: Array<Record<string, unknown>> };
    expect(page.changes[0]).toMatchObject({ edit_scope: 'component', render_count: 19 });
    const c = projectChange({ ...base, apply_event_seq: null, commit_sha: 'abc', parent_sha: null, files: [], render_count: 2, edit_scope: 'instance', pin_ids: [], gates: null, is_restore: false, restored_from: null, designer_note: null, decided_at: null, created_at: new Date() });
    expect(c.edit_scope).toBe('instance');
  });
});
