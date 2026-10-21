import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ChatView } from '../chat-view';

// ChatView against a faked GET /api/portal/chat/:id: a numbers reply with its source line, the
// writing label from the server, a tree-mode ask rendered like any other, and the filed block.
const base = {
  conversation_id: 'c1', task_id: 't1', site_id: 's1', state: 'clarifying', mode: 'model', writing: false, writing_note: null,
  writing_label: null, pending: null, urgent: null, banner: null, poll_seconds: 30,
};
const msg = (over: Record<string, unknown>) => ({
  id: 'm1', who: 'assistant', mine: false, name: 'Indelible assistant', text: 'Hello.', created_at: '2026-10-21T14:00:00.000Z', sources: [], attachments: [], ...over,
});

function fakeFetch(payload: unknown) {
  global.fetch = vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })) as unknown as typeof fetch;
}
const view = () => render(<ChatView source={{ conversationId: 'c1' }} composerLabel="Add a message" hint="Saved when sent." />);

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => vi.restoreAllMocks());

describe('ChatView', () => {
  it('renders a source line under a numbers reply', async () => {
    fakeFetch({ ...base, messages: [msg({ text: 'About 3 people.', sources: [{ label: 'Google Analytics, Oct 1 to Oct 20, 2026', range: 'Oct 1 to Oct 20, 2026' }] })] });
    view();
    await waitFor(() => expect(screen.getByTestId('chat-source').textContent).toBe('Source: Google Analytics, Oct 1 to Oct 20, 2026'));
  });

  it('shows the writing bubble with the server label, aria-busy on the log', async () => {
    fakeFetch({ ...base, writing: true, writing_note: 'checking_numbers', writing_label: 'Checking your numbers', messages: [msg({ who: 'client', mine: true, name: 'Dana', text: 'How many visits?' })] });
    view();
    await waitFor(() => expect(screen.getByTestId('chat-writing').textContent).toContain('Checking your numbers'));
    expect(screen.getByRole('log').getAttribute('aria-busy')).toBe('true');
  });

  it('renders a tree-mode ask like any other: choices from the server', async () => {
    fakeFetch({
      ...base, mode: 'tree', messages: [msg({ text: 'Which site is this about?' })],
      pending: { kind: 'ask', slot: 'site', question: 'Which site is this about?', choices: [{ id: 'a', label: 'maple.example' }], allow_free_text: false, allow_upload: false, search_pages: false },
    });
    view();
    const group = await screen.findByTestId('chat-choices-site');
    expect(group.textContent).toContain('maple.example');
  });

  it('shows the handoff banner and the filed block, and keeps the composer', async () => {
    fakeFetch({ ...base, state: 'with_person', banner: 'A person on the team will reply here. You can keep adding details while you wait.', messages: [msg({})] });
    view();
    await screen.findByTestId('chat-handoff');
    expect(screen.getByLabelText('Add a message')).toBeTruthy();
  });

  it('asks for a file by opening the drop area', async () => {
    fakeFetch({
      ...base, messages: [msg({ text: 'Attach the photo here.' })],
      pending: { kind: 'ask', slot: 'asset', question: 'Attach the photo here.', choices: [{ id: 'no_file', label: 'No file' }], allow_free_text: true, allow_upload: true, search_pages: false },
    });
    view();
    await screen.findByTestId('chat-drop');
  });
});

describe('ChatView confirm answering "already filed"', () => {
  it('shows the plain line with a link to the request', async () => {
    const summary = {
      kind: 'summary', version: 1, text: null, rows: [{ label: 'Site', value: 'maple.example' }], files: [], destination: null, quote_line: null, urgent_line: null,
      choose_project: null, buttons: { send: 'Send to the team', change: 'Change something' },
    };
    global.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/confirm') && init?.method === 'POST')
        return new Response(JSON.stringify({ state: 'filed', already: true, lines: ['This request was already filed. Open it from Requests.'], task_id: 't9' }), { status: 200 });
      return new Response(JSON.stringify({ ...base, state: 'confirming', messages: [msg({})], pending: summary }), { status: 200 });
    }) as unknown as typeof fetch;
    render(<ChatView source={{ conversationId: 'c1' }} composerLabel="Add a message" hint="Saved when sent." />);
    (await screen.findByRole('button', { name: 'Send to the team' })).click();
    const line = await screen.findByTestId('chat-already-filed');
    expect(line.textContent).toContain('already filed');
    expect(line.querySelector('a')?.getAttribute('href')).toBe('/portal/work/t9');
  });
});
