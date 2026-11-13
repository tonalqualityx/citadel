import { describe, it, expect, vi } from 'vitest';
import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { BastChatPanel } from '../BastChatPanel';
import { DOX_EMPTY_HINT } from '@/lib/tasks/triage-copy';
import type { UseBastChat } from '@/lib/hooks/use-bast-chat';

const chat = (timeline: unknown[] = []) =>
  ({ timeline, liveText: '', liveAction: null, working: false, notice: null, error: null, conversationStatus: 'idle', now: Date.now(), send: vi.fn(), sendAgain: vi.fn(), stop: vi.fn() }) as unknown as UseBastChat;
const props = { card: null, aboutDropped: false, onDropAbout: vi.fn(), draft: '', setDraft: vi.fn(), onLeaveCardChat: vi.fn() };
const msg = (role: 'mike' | 'bast', text: string) => ({ type: 'message', key: `${role}${text}`, message: { id: text, role, text, state: 'done', canResend: false } });

describe('the chat panel names who you are talking to', () => {
  it('on a card: Dox, with his own hint, label on his turns and a composer for him', () => {
    render(<BastChatPanel {...props} chat={chat()} cardChatTitle="Idea about invoices" />);
    expect(screen.getByText(DOX_EMPTY_HINT)).toBeTruthy();
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('Conversation with Dox');
    expect((screen.getByTestId('bast-chat-input') as HTMLTextAreaElement).placeholder).toBe('Message Dox');
  });

  it('on a card, assistant turns are labelled Dox and Mike\'s are not', () => {
    render(<BastChatPanel {...props} chat={chat([msg('mike', 'hello'), msg('bast', 'Here is the card')])} cardChatTitle="Idea" />);
    const labels = screen.getAllByTestId('speaker-label');
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe('Dox');
  });

  it('the general chat stays Bast: no label, Bast hint and composer', () => {
    render(<BastChatPanel {...props} chat={chat([msg('bast', 'Hi')])} cardChatTitle={null} />);
    expect(screen.queryByTestId('speaker-label')).toBeNull();
    expect(screen.getByRole('log').getAttribute('aria-label')).toBe('Conversation with Bast');
    expect((screen.getByTestId('bast-chat-input') as HTMLTextAreaElement).placeholder).toBe('Message Bast');
  });
});
