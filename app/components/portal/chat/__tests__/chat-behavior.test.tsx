import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { useChat } from '../use-chat';
import { Composer } from '../composer';
import { ChatView } from '../chat-view';
import { IntakeChat } from '@/components/portal/intake/intake-chat';
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => {}, push: () => {} }) }));

const base = {
  conversation_id: 'c1', task_id: 't1', site_id: 's1', state: 'clarifying', mode: 'model', writing: false, writing_note: null,
  writing_label: null, pending: null, urgent: null, banner: null, poll_seconds: 30, messages: [],
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status });

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('one poll loop per conversation', () => {
  it('sending during an in-flight poll does not add a second loop', async () => {
    vi.useFakeTimers();
    let polls = 0;
    let releaseFirst: (() => void) | null = null;
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (init?.method === 'POST') return json({ comment_id: 'm', route: 'queued' }, 201);
      if (u.includes('/api/portal/chat/c1')) {
        polls++;
        if (polls === 1) await new Promise<void>((r) => (releaseFirst = r)); // the first poll is slow
        return json({ ...base, writing: true });
      }
      return json({});
    }) as unknown as typeof fetch;

    const { result } = renderHook(() => useChat({ conversationId: 'c1' }));
    await act(async () => {}); // first poll is now in flight
    await act(async () => {
      await result.current.send({ text: 'hello' }); // wakes the loop while that poll is still in flight
    });
    await act(async () => {
      releaseFirst?.();
    });
    // Exactly one timer is pending: one loop. (Two loops would leave two.)
    expect(vi.getTimerCount()).toBe(1);
    const before = polls;
    // 30 seconds at the fast pace (3 s) is 10 polls from one loop; two loops would make about 20.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    const made = polls - before;
    expect(made).toBeGreaterThanOrEqual(9);
    expect(made).toBeLessThanOrEqual(11);
  });
});

describe('Enter in the composer', () => {
  const props = (over: Record<string, unknown> = {}) => ({
    label: 'Message', hint: 'h', value: 'hello', onChange: () => {}, onTyping: () => {}, onSend: vi.fn(), sending: false, error: null,
    drafts: [], onFiles: () => {}, onRemoveFile: () => {}, filesProblem: null, wantsFile: false, textareaRef: { current: null }, ...over,
  });
  it('sends on Enter, adds a line on Shift plus Enter, and ignores Enter while composing', () => {
    const p = props();
    render(<Composer {...(p as React.ComponentProps<typeof Composer>)} />);
    const box = screen.getByLabelText('Message');
    fireEvent.keyDown(box, { key: 'Enter', shiftKey: true });
    expect(p.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true, keyCode: 229 });
    expect(p.onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(p.onSend).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Press Enter to send/)).toBeTruthy();
  });
  it('keeps Enter as a new line on a phone (coarse pointer)', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
    const p = props();
    render(<Composer {...(p as React.ComponentProps<typeof Composer>)} />);
    fireEvent.keyDown(screen.getByLabelText('Message'), { key: 'Enter' });
    expect(p.onSend).not.toHaveBeenCalled();
    // @ts-expect-error restore the jsdom default of no matchMedia
    delete window.matchMedia;
  });
});

describe('ChatView details', () => {
  const summary = {
    kind: 'summary', version: 3, text: null, rows: [{ label: 'Site', value: 'maple.example' }], files: [], destination: null, quote_line: null,
    urgent_line: null, choose_project: null, buttons: { send: 'Send to the team', change: 'Change something' },
  };
  it('disables Send after a successful confirm, until the next refresh', async () => {
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/confirm') && init?.method === 'POST') return json({ state: 'filed', lines: [], task_id: 't1' });
      return json({ ...base, state: 'confirming', pending: summary });
    }) as unknown as typeof fetch;
    render(<ChatView source={{ conversationId: 'c1' }} composerLabel="Add a message" hint="x" />);
    const send = (await screen.findByRole('button', { name: 'Send to the team' })) as HTMLButtonElement;
    fireEvent.click(send);
    await waitFor(() => expect((screen.getByRole('button', { name: /Send to the team|Sending/ }) as HTMLButtonElement).disabled).toBe(true));
  });

  it('shows a one-line chip, not the full card, for a request that was already filed when the page opened', async () => {
    global.fetch = vi.fn(async () => json({ ...base, state: 'filed' })) as unknown as typeof fetch;
    render(<ChatView source={{ conversationId: 'c1' }} composerLabel="Add a message" hint="x" viewRequestHref={(id) => `/portal/work/${id}`} />);
    await screen.findByTestId('chat-sent-chip');
    expect(screen.queryByTestId('chat-sent')).toBeNull();
  });

  it('never shows a raw server error: a failed send reads as the fixed line', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn(async (_u: string | URL | Request, init?: RequestInit) =>
      init?.method === 'POST' ? json({ error: 'P2002 unique constraint failed on the fields: (intake_id)', code: 'internal' }, 500) : json(base)
    ) as unknown as typeof fetch;
    render(<ChatView source={{ conversationId: 'c1' }} composerLabel="Add a message" hint="x" />);
    fireEvent.change(await screen.findByLabelText('Add a message'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByText('Something went wrong. Try again.');
    expect(screen.queryByText(/P2002/)).toBeNull();
  });
});

describe('stepper fallback keeps what was typed', () => {
  it('shows the carried text and puts it in the first free-text answer', async () => {
    global.fetch = vi.fn(async () =>
      json({ can_request: true, sites: [{ id: 's1', name: 'Maple', has_plan: false }], open_builds: [], charters: [] })
    ) as unknown as typeof fetch;
    render(<IntakeChat initialText="Please change my opening hours." carriedFiles={1} />);
    const carried = await screen.findByTestId('intake-carried');
    expect(carried.textContent).toContain('Please change my opening hours.');
    expect(carried.textContent).toContain('Your files were not sent');
  });
});
