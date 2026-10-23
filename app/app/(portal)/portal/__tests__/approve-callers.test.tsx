// Fleet item 5: every place a client can approve a staged task must send the preview address AND the deploy
// time it displayed, because the approve routes record a yes only for the build the client saw.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Suspense } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  useParams: () => ({ id: 'task-1', token: 'tok-1' }),
  usePathname: () => '/portal',
  useSearchParams: () => new URLSearchParams(),
}));

import ProjectPage from '../projects/[id]/page';
import WorkPage from '../work/[id]/page';
import HomePage from '../home/page';
import TaskApprovalPage from '../task-approval/[token]/page';
import { PlanApprovalBlock } from '@/components/portal/plan-approval-block';

const URL1 = 'https://p.example.test/preview-1';
const AT1 = '2026-10-22T12:00:00.000Z';

/** A promise React's use() can read at once (it looks for status and value on the thenable). */
function resolved<T>(value: T): Promise<T> {
  const p = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  p.status = 'fulfilled';
  p.value = value;
  return p;
}

const fetchMock = vi.fn();
const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as Response;

/** Serve the page's GET loads from `loads` (by path prefix) and answer every POST to /approve with `post`. */
function serve(loads: Record<string, unknown>, post: Response = ok({ approved_at: AT1 })) {
  fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return post;
    const key = Object.keys(loads).find((k) => url.startsWith(k));
    return ok(key ? loads[key] : {});
  });
}
const approveCall = () => fetchMock.mock.calls.find(([, init]) => init?.method === 'POST') as [string, { body: string }] | undefined;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

describe('approve callers send the preview and deploy time they displayed', () => {
  it('projects/[id] page', async () => {
    serve({
      '/api/portal/projects/': {
        project: { id: 'p1', name: 'Site refresh', status_label: 'In progress', target_date: null, completed_date: null, progress: { done: 0, total: 1 }, current_phase: null },
        phases: [],
        tasks: [],
        needs_from_you: { approvals: [{ id: 'task-1', title: 'Homepage', staging_preview_url: URL1, staging_deployed_at: AT1 }], requests: [], review_link: null },
        links: [],
        history: [],
      },
    });
    render(<ProjectPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveCall()).toBeTruthy());
    const [url, init] = approveCall()!;
    expect(url).toBe('/api/portal/tasks/mine/task-1/approve');
    expect(JSON.parse(init.body)).toEqual({ preview_url: URL1, staging_deployed_at: AT1 });
  });

  it('work/[id] page', async () => {
    serve({
      '/api/portal/work/': {
        work: {
          id: 'task-1', title: 'Footer hours', state: { label: 'Ready for you', tone: 'attention' }, engagement: 'one_off', site: null, requested_by: null,
          requested_at: AT1, approved_at: null, answers: [], staged: { preview_url: URL1, staging_deployed_at: AT1, awaiting_approval: true }, can_act: true, cancel: 'allowed',
        },
        chat: { conversation_id: null, available: false },
      },
    });
    render(
      <Suspense fallback={null}>
        <WorkPage params={resolved({ id: 'task-1' })} />
      </Suspense>
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveCall()).toBeTruthy());
    const [url, init] = approveCall()!;
    expect(url).toBe('/api/portal/tasks/mine/task-1/approve');
    expect(JSON.parse(init.body)).toEqual({ preview_url: URL1, staging_deployed_at: AT1 });
  });

  it('plan approval block', async () => {
    serve({});
    const onChanged = vi.fn();
    render(<PlanApprovalBlock plan={{ task_id: 'task-1', title: 'November plan', preview_url: URL1, staging_deployed_at: AT1, book_href: '/portal/book' }} monthName="November" onChanged={onChanged} />);
    fireEvent.click(screen.getByRole('button', { name: 'Approve the plan' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const [url, init] = approveCall()!;
    expect(url).toBe('/api/portal/tasks/mine/task-1/approve');
    expect(JSON.parse(init.body)).toEqual({ preview_url: URL1, staging_deployed_at: AT1 });
  });

  it('home page', async () => {
    serve({
      '/api/portal/home': {
        client: { id: 'c1', name: 'Acme' },
        retainers: [],
        requests: { open_count: 0, top: [] },
        pending_approvals: {
          articles: [],
          tasks: [{ id: 'task-1', title: 'Footer hours', description: null, status: 'review', comments: [], staging_preview_url: URL1, staging_deployed_at: AT1, created_at: AT1, updated_at: AT1 }],
        },
        needs_from_you: { questions: [], review_links: [] },
        projects: [],
        billing: null,
        stats: [],
        activity: [],
      },
    });
    render(<HomePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(approveCall()).toBeTruthy());
    const [url, init] = approveCall()!;
    expect(url).toBe('/api/portal/tasks/mine/task-1/approve');
    expect(JSON.parse(init.body)).toEqual({ preview_url: URL1, staging_deployed_at: AT1 });
  });

  it('approval-link page', async () => {
    serve({
      '/api/portal/tasks/tok-1': {
        task: { id: 'task-1', title: 'Footer hours', description: null, status: 'review', comments: [], staging_preview_url: URL1, staging_deployed_at: AT1, created_at: AT1, updated_at: AT1 },
        staging_preview_url: URL1,
        staging_deployed_at: AT1,
        already_approved: false,
        contact: { id: 'ct1', name: 'Olive' },
        can_request_changes: true,
        available_sites: [],
      },
    });
    render(<TaskApprovalPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    // the confirm panel has its own submit button
    const confirm = (await screen.findAllByRole('button', { name: /approve|confirm|yes/i })).pop()!;
    fireEvent.click(confirm);
    await waitFor(() => expect(approveCall()).toBeTruthy());
    const [url, init] = approveCall()!;
    expect(url).toBe('/api/portal/tasks/tok-1/approve');
    expect(JSON.parse(init.body)).toEqual({ preview_url: URL1, staging_deployed_at: AT1 });
  });
});
