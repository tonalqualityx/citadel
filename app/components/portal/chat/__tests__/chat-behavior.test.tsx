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

describe('Drop area does not flicker', () => {
  const props = () => ({
    label: 'Message', hint: 'h', value: '', onChange: () => {}, onTyping: () => {}, onSend: () => {}, sending: false, error: null,
    drafts: [], onFiles: vi.fn(), onRemoveFile: () => {}, filesProblem: null, wantsFile: false, textareaRef: { current: null },
  });
  const files = { types: ['Files'], files: [] as File[] };

  it('crossing child elements (leave then enter) keeps one overlay up, and it ignores the pointer', () => {
    const { container } = render(<Composer {...(props() as React.ComponentProps<typeof Composer>)} />);
    const form = container.querySelector('form')!;
    const child = screen.getByLabelText('Message');
    const states: boolean[] = [];
    const seen = () => states.push(Boolean(screen.queryByTestId('chat-drop-active')));

    fireEvent.dragEnter(form, { dataTransfer: files });
    seen();
    // The browser order when the pointer moves onto a child: enter the child first, then leave the form.
    fireEvent.dragEnter(child, { dataTransfer: files });
    seen();
    fireEvent.dragLeave(form, { dataTransfer: files });
    seen();
    fireEvent.dragOver(child, { dataTransfer: files });
    seen();
    // And back out over the child, into the form, out of the child.
    fireEvent.dragEnter(form, { dataTransfer: files });
    fireEvent.dragLeave(child, { dataTransfer: files });
    seen();
    expect(states).toEqual([true, true, true, true, true]); // never off between enter and leave: no flicker

    fireEvent.dragLeave(form, { dataTransfer: files });
    expect(screen.queryByTestId('chat-drop-active')).toBeNull(); // the last leave closes it once
  });

  it('the overlay is mounted once, never replaced, while the drag moves around', () => {
    const { container } = render(<Composer {...(props() as React.ComponentProps<typeof Composer>)} />);
    const form = container.querySelector('form')!;
    fireEvent.dragEnter(form, { dataTransfer: files });
    const first = screen.getByTestId('chat-drop-active');
    fireEvent.dragEnter(screen.getByLabelText('Message'), { dataTransfer: files });
    fireEvent.dragLeave(form, { dataTransfer: files });
    expect(screen.getByTestId('chat-drop-active')).toBe(first);
  });

  it('a drop attaches the files and closes the overlay; a drag end does too', () => {
    const p = props();
    const { container } = render(<Composer {...(p as React.ComponentProps<typeof Composer>)} />);
    const form = container.querySelector('form')!;
    const file = new File(['x'], 'a.png', { type: 'image/png' });
    fireEvent.dragEnter(form, { dataTransfer: files });
    fireEvent.dragEnter(screen.getByLabelText('Message'), { dataTransfer: files });
    fireEvent.drop(form, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(p.onFiles).toHaveBeenCalledWith([file]);
    expect(screen.queryByTestId('chat-drop-active')).toBeNull();

    fireEvent.dragEnter(form, { dataTransfer: files });
    expect(screen.getByTestId('chat-drop-active')).toBeTruthy();
    fireEvent(window, new Event('dragend'));
    expect(screen.queryByTestId('chat-drop-active')).toBeNull();
    // The counter was reset: one new enter and one leave is a clean open and close.
    fireEvent.dragEnter(form, { dataTransfer: files });
    fireEvent.dragLeave(form, { dataTransfer: files });
    expect(screen.queryByTestId('chat-drop-active')).toBeNull();
  });

  it('ignores drags that carry no files (selected text)', () => {
    const { container } = render(<Composer {...(props() as React.ComponentProps<typeof Composer>)} />);
    fireEvent.dragEnter(container.querySelector('form')!, { dataTransfer: { types: ['text/plain'] } });
    expect(screen.queryByTestId('chat-drop-active')).toBeNull();
  });
});

describe('A staff reply while a person has the conversation', () => {
  const withPersonBase = { ...base, state: 'with_person', banner: 'A person on the team will reply here. You can keep adding details while you wait.', staff_reply: null };
  const mk = (id: string, who: string, name: string, text: string, at: string) => ({ id, who, mine: false, name, text, created_at: at, sources: [], attachments: [] });

  it('keeps polling in with_person, and the banner turns into "<First> from Indelible replied." with a person mark on the bubble', async () => {
    vi.useFakeTimers();
    let replied = false;
    let polls = 0;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      if (!String(url).includes('/api/portal/chat/c1')) return json({});
      polls++;
      return json(
        replied
          ? { ...withPersonBase, banner: 'Mike from Indelible replied.', staff_reply: { first_name: 'Mike', at: '2026-10-22T01:43:00Z' }, messages: [mk('m2', 'team', 'Indelible team', 'We fixed the hours.', '2026-10-22T01:43:00.000Z')] }
          : { ...withPersonBase, messages: [mk('m1', 'assistant', 'Indelible assistant', 'A person will reply.', '2026-10-22T01:00:00.000Z')] }
      );
    }) as unknown as typeof fetch;
    render(<ChatView source={{ conversationId: 'c1' }} composerLabel="Add a message" hint="x" />);
    await act(async () => {});
    expect(screen.getByTestId('chat-handoff')).toHaveTextContent('A person on the team will reply here.');
    expect(screen.queryByTestId('chat-person-mark')).toBeNull();

    replied = true;
    const before = polls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000); // one person-rate poll, no reload
    });
    expect(polls).toBeGreaterThan(before);
    const banner = screen.getByTestId('chat-handoff');
    expect(banner).toHaveTextContent('Mike from Indelible replied.');
    expect(banner).not.toHaveTextContent('A person on the team will reply here');
    expect(screen.getByText('Indelible team')).toBeTruthy();
    expect(screen.getByTestId('chat-person-mark')).toBeTruthy();
    expect(screen.getByText('We fixed the hours.')).toBeTruthy();
  });

  it('does not poll while the tab is hidden', async () => {
    vi.useFakeTimers();
    let polls = 0;
    global.fetch = vi.fn(async () => {
      polls++;
      return json({ ...withPersonBase, messages: [] });
    }) as unknown as typeof fetch;
    renderHook(() => useChat({ conversationId: 'c1' }));
    await act(async () => {});
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const before = polls;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(polls).toBe(before);
  });
});
