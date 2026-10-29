import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const get = vi.fn();
const post = vi.fn();
const patch = vi.fn();
const put = vi.fn();
vi.mock('@/lib/api/client', () => ({
  apiClient: { get: (...a: unknown[]) => get(...a), post: (...a: unknown[]) => post(...a), patch: (...a: unknown[]) => patch(...a), put: (...a: unknown[]) => put(...a) },
}));
const toast = vi.hoisted(() => ({ apiError: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: toast }));
const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { PublishConfirmDialog } from '../PublishConfirmDialog';
import { PublishButton } from '../PublishButton';
import { RollbackButton } from '../RollbackButton';
import { AdminSettings, modelError } from '../AdminSettings';
import { SiteToggles } from '../SiteToggles';
import type { PublishIntent } from '@/lib/hooks/use-design-publish';
import type { AdminSettings as Settings } from '@/lib/hooks/use-design-admin';
import type { DesignFeedResponse } from '@/lib/hooks/use-design';

function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

function intent(role: 'client_preview' | 'production', over: Partial<PublishIntent['shown']> = {}): PublishIntent {
  const production = role === 'production';
  return {
    publish_id: 'p1',
    confirmation_token: 'tok-1',
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    shown: {
      target_label: production ? 'Live production site' : 'Client preview',
      target_words: production ? 'the LIVE production site at vcdp.org' : 'the client preview at vcdp.pages.dev',
      heading: 'Publish',
      button_label: 'Publish',
      tone: role,
      live_url: production ? 'https://vcdp.org' : 'https://vcdp.pages.dev',
      main_role: role,
      main_branch: 'main',
      type_to_confirm: 'Type main to confirm',
      head_sha: 'abc1234',
      diff_summary: { files_changed: 2, insertions: 10, deletions: 3 },
      files_changed: ['src/index.njk', 'src/css/site.css'],
      pages_affected: ['/', '/about/'],
      gates: { status: 'green', entries: [{ name: 'a11y', ok: true }, { name: 'build', ok: true }] },
      cost_usd: 1.25,
      ...over,
    },
  };
}

const confirmCalls = () => post.mock.calls.filter((c) => String(c[0]).includes('/confirm'));

async function openStep2() {
  await screen.findByText(/This publishes to/);
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

beforeEach(() => {
  [get, post, patch, put, push].forEach((f) => f.mockReset());
  Object.values(toast).forEach((f) => f.mockReset());
});

describe('PublishConfirmDialog', () => {
  it('never calls confirm without the exact main branch typed', async () => {
    post.mockImplementation(async (url: string) => (url.endsWith('/publish') ? intent('client_preview') : { publish_id: 'p1' }));
    wrap(<PublishConfirmDialog sessionId="s1" headSha="abc1234" open onOpenChange={() => {}} />);
    await openStep2();
    const input = screen.getByLabelText('Type main to confirm');
    const submit = screen.getByRole('button', { name: /Publish to the client preview/ });
    expect(submit).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Main' } });
    expect(submit).toBeDisabled();
    fireEvent.submit(screen.getByTestId('publish-dialog'));
    expect(confirmCalls()).toHaveLength(0);
    fireEvent.change(input, { target: { value: 'main' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(confirmCalls()).toHaveLength(1));
    expect(confirmCalls()[0]).toEqual(['/design/publishes/p1/confirm', { confirmation_token: 'tok-1', typed_confirmation: 'main' }]);
    expect(post.mock.calls[0]).toEqual(['/design/sessions/s1/publish', { head_sha: 'abc1234' }]);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/design/publishes/p1'));
  });

  it('never calls confirm when the intent carries no token', async () => {
    post.mockImplementation(async () => ({ ...intent('client_preview'), confirmation_token: '' }));
    wrap(<PublishConfirmDialog sessionId="s1" headSha="abc1234" open onOpenChange={() => {}} />);
    await openStep2();
    fireEvent.change(screen.getByLabelText('Type main to confirm'), { target: { value: 'main' } });
    expect(screen.getByRole('button', { name: /Publish to/ })).toBeDisabled();
    fireEvent.submit(screen.getByTestId('publish-dialog'));
    expect(confirmCalls()).toHaveLength(0);
  });

  it('uses production wording and warning colors when main_role is production', async () => {
    post.mockResolvedValue(intent('production'));
    wrap(<PublishConfirmDialog sessionId="s1" headSha="abc1234" open onOpenChange={() => {}} />);
    await screen.findByText(/This publishes to/);
    expect(screen.getByTestId('publish-dialog')).toHaveAttribute('data-tone', 'production');
    expect(screen.getByTestId('publish-target')).toHaveClass('border-error');
    expect(screen.getByText('Live production site')).toBeInTheDocument();
    expect(screen.getByText(/the LIVE production site at vcdp.org/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    const btn = screen.getByRole('button', { name: 'Publish to the LIVE production site at https://vcdp.org' });
    expect(btn).toHaveClass('bg-red-600');
  });

  it('uses client-preview wording with normal styling otherwise, and shows diff, gates, pages and cost', async () => {
    post.mockResolvedValue(intent('client_preview'));
    wrap(<PublishConfirmDialog sessionId="s1" headSha="abc1234" open onOpenChange={() => {}} />);
    await screen.findByText(/This publishes to/);
    expect(screen.getByTestId('publish-dialog')).toHaveAttribute('data-tone', 'client_preview');
    expect(screen.getByTestId('publish-target')).not.toHaveClass('border-error');
    expect(screen.getByText(/the client preview at vcdp.pages.dev/)).toBeInTheDocument();
    expect(screen.queryByText(/LIVE production/)).toBeNull();
    expect(screen.getByTestId('diff-summary')).toHaveTextContent('2 files, +10 / -3');
    expect(screen.getByTestId('pages-affected')).toHaveTextContent('/, /about/');
    expect(screen.getByText('$1.25')).toBeInTheDocument();
    expect(screen.getAllByText('Green')).toHaveLength(2);
    expect(screen.getByTestId('publish-countdown')).toHaveTextContent(/expires in 9:5\d|expires in 10:00/);
  });

  it('shows red gates in the error color', async () => {
    post.mockResolvedValue(intent('client_preview', { gates: { status: 'red', entries: [{ name: 'a11y', ok: false }] } }));
    wrap(<PublishConfirmDialog sessionId="s1" headSha="abc1234" open onOpenChange={() => {}} />);
    expect(await screen.findByText('Red')).toHaveClass('text-error');
  });

  it('on a 409 shows the reason and a review-again flow that re-runs step 1', async () => {
    let intents = 0;
    post.mockImplementation(async (url: string) => {
      if (url.endsWith('/publish')) {
        intents += 1;
        return intent('client_preview');
      }
      throw new Error('The design branch moved since the review; review again');
    });
    wrap(<PublishConfirmDialog sessionId="s1" headSha="abc1234" open onOpenChange={() => {}} />);
    await openStep2();
    fireEvent.change(screen.getByLabelText('Type main to confirm'), { target: { value: 'main' } });
    fireEvent.click(screen.getByRole('button', { name: /Publish to the client preview/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The design branch moved since the review');
    fireEvent.click(screen.getByRole('button', { name: 'Review again' }));
    await waitFor(() => expect(intents).toBe(2));
    expect(await screen.findByRole('button', { name: 'Continue' })).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});

function feed(publish: Partial<DesignFeedResponse['publish']>, over: Partial<DesignFeedResponse> = {}): DesignFeedResponse {
  return {
    events: [], live: { text: null, action: null }, status: 'awaiting_input', stale: false,
    publish: { can_publish: false, main_role: 'client_preview', precheck: null, ...publish },
    timer: null, cost_usd: 1, budget_usd: 5, preview_url: 'https://x.pages.dev', preview_sha: 'abc1234', head_sha: 'abc1234',
    last_heartbeat_at: null, next_poll_ms: 5000, last_seq: 0, has_more: false, ...over,
  };
}

describe('PublishButton', () => {
  it('is disabled with the server reason when can_publish is false', () => {
    wrap(<PublishButton sessionId="s1" feed={feed({ can_publish: false, reason: 'gates_not_green' })} />);
    const btn = screen.getByRole('button', { name: 'Publish to live...' });
    expect(btn).toBeDisabled();
    expect(btn.parentElement).toHaveAttribute('title', 'The gates have not run green on this version yet.');
    expect(screen.queryByRole('button', { name: 'Request publish' })).toBeNull();
  });

  it('is enabled when the server says yes and opens the dialog', async () => {
    post.mockResolvedValue(intent('client_preview'));
    wrap(<PublishButton sessionId="s1" feed={feed({ can_publish: true })} />);
    const btn = screen.getByRole('button', { name: 'Publish to live...' });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    expect(await screen.findByText(/This publishes to/)).toBeInTheDocument();
  });

  it('shows Request publish only for the designer_publish_off reason, with an owner note and no approval wording', async () => {
    post.mockResolvedValue({});
    wrap(<PublishButton sessionId="s1" feed={feed({ can_publish: false, reason: 'designer_publish_off' })} />);
    expect(screen.queryByRole('button', { name: 'Publish to live...' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Request publish' }));
    fireEvent.change(screen.getByLabelText('Note to the owner (optional)'), { target: { value: ' ready ' } });
    expect(screen.queryByText(/approv/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send note' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/design/sessions/s1/request-publish', { note: 'ready' }));
  });

  it('never shows Request publish when publishing is simply allowed', () => {
    wrap(<PublishButton sessionId="s1" feed={feed({ can_publish: true })} />);
    expect(screen.queryByRole('button', { name: 'Request publish' })).toBeNull();
  });
});

describe('RollbackButton', () => {
  const base = { publishId: 'p1', targetWords: 'the LIVE production site at vcdp.org' };
  it('is visible to an admin or the publisher on the latest publish only', () => {
    const { rerender } = wrap(<RollbackButton {...base} canRollback isAdmin isPublisher={false} />);
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeInTheDocument();
    const again = (props: { canRollback: boolean; isAdmin: boolean; isPublisher: boolean }) =>
      rerender(<QueryClientProvider client={new QueryClient()}><RollbackButton {...base} {...props} /></QueryClientProvider>);
    again({ canRollback: true, isAdmin: false, isPublisher: true });
    expect(screen.getByRole('button', { name: 'Roll back' })).toBeInTheDocument();
    again({ canRollback: true, isAdmin: false, isPublisher: false });
    expect(screen.queryByRole('button', { name: 'Roll back' })).toBeNull();
    again({ canRollback: false, isAdmin: true, isPublisher: true });
    expect(screen.queryByRole('button', { name: 'Roll back' })).toBeNull();
  });

  it('confirms in the same words, then posts the rollback', async () => {
    post.mockResolvedValue({ publish_id: 'r1' });
    const done = vi.fn();
    wrap(<RollbackButton {...base} canRollback isAdmin isPublisher={false} onRolledBack={done} />);
    fireEvent.click(screen.getByRole('button', { name: 'Roll back' }));
    expect(screen.getByText(/puts the LIVE production site at vcdp.org back/)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Roll back the LIVE production site at vcdp.org' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/design/publishes/p1/rollback', {}));
    await waitFor(() => expect(done).toHaveBeenCalledWith('r1'));
  });
});

const SETTINGS: Settings = {
  enabled: true, owner_user_id: null, designer_publish_mode: 'per_site', confirmation_ttl_minutes: 10, default_session_budget_usd: 25,
  designer_raise_cap_usd: 50, hard_session_cap_usd: 100, default_monthly_cap_usd: null, model: 'claude-opus-4', effort: 'high',
  idle_close_minutes: 10, auto_timer_enabled: true, auto_timer_lapse_minutes: 5, auto_timer_billable: false, max_live_sessions: 4, updated_at: null,
};

describe('AdminSettings', () => {
  beforeEach(() => get.mockResolvedValue({ users: [] }));

  it('renders the publish mode select with its three modes', () => {
    wrap(<AdminSettings settings={SETTINGS} canWrite />);
    const select = screen.getByLabelText('Designer publish mode') as HTMLSelectElement;
    expect([...select.options].map((o) => o.value).filter(Boolean)).toEqual(['per_site', 'pre_launch_only', 'off']);
    expect(select.value).toBe('per_site');
  });

  it('W8.1 H5: the client mirrors the server allowlist', () => {
    for (const m of ['best', 'default', 'mythos', 'claude-fable-5-1', 'gpt-5']) expect(modelError(m), m).not.toBeNull();
    for (const m of ['opus', 'sonnet', 'haiku', 'claude-opus-4-5-20251101']) expect(modelError(m), m).toBeNull();
    expect(modelError('best')).toMatch(/opus, sonnet or haiku/);
  });
  it('refuses a fable model client-side and sends nothing', () => {
    expect(modelError('Fable-5')).toMatch(/Fable/);
    wrap(<AdminSettings settings={SETTINGS} canWrite />);
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'fable-x' } });
    expect(screen.getByText(/Fable model cannot be used/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save settings' })).toBeDisabled();
    fireEvent.submit(screen.getByRole('form', { name: 'Designer portal settings' }));
    expect(patch).not.toHaveBeenCalled();
  });

  it('PATCHes only what changed', async () => {
    patch.mockResolvedValue({ settings: SETTINGS });
    wrap(<AdminSettings settings={SETTINGS} canWrite />);
    fireEvent.change(screen.getByLabelText('Designer publish mode'), { target: { value: 'off' } });
    fireEvent.change(screen.getByLabelText('Max live sessions'), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/admin/settings', { designer_publish_mode: 'off', max_live_sessions: 6 }));
  });
});

describe('SiteToggles', () => {
  const site = { id: 'site1', name: 'VCDP', url: null, design_portal_enabled: true, designer_publish: true, design_auto_timer: true, effective_designer_publish: true, main_role: 'client_preview' };

  it('PATCHes one field per switch to the admin site route', async () => {
    get.mockResolvedValue({ sites: [site] });
    patch.mockResolvedValue({});
    wrap(<SiteToggles canWrite />);
    const sw = await screen.findAllByRole('switch');
    expect(sw).toHaveLength(3);
    expect(sw.every((s) => s.getAttribute('aria-checked') === 'true')).toBe(true);
    fireEvent.click(sw[0]);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/admin/sites/site1', { design_portal_enabled: false }));
    await waitFor(() => expect(screen.getAllByRole('switch')[1]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('switch')[1]);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/admin/sites/site1', { designer_publish: false }));
    await waitFor(() => expect(screen.getAllByRole('switch')[2]).toBeEnabled());
    fireEvent.click(screen.getAllByRole('switch')[2]);
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/design/admin/sites/site1', { design_auto_timer: false }));
  });

  it('is read-only for a pm', async () => {
    get.mockResolvedValue({ sites: [site] });
    wrap(<SiteToggles canWrite={false} />);
    const sw = await screen.findAllByRole('switch');
    expect(sw.every((s) => (s as HTMLButtonElement).disabled)).toBe(true);
  });
});
