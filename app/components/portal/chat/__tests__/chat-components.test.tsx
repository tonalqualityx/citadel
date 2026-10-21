import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SummaryCard } from '../summary-card';
import { WritingBubble } from '../writing-bubble';
import { DisclosureLine } from '../disclosure-line';
import { HandoffBanner } from '../handoff-banner';
import { AttachmentChip } from '../attachment-chip';
import { ChoiceButtons } from '../choice-buttons';
import { mergeMessages } from '../use-chat';
import type { ChatMessage, SummaryPending } from '../types';
import { extractDraft } from '@/components/domain/tasks/chat-staff-panel';

const summary: SummaryPending = {
  kind: 'summary', version: 2, text: 'On the About page, replace the photo.',
  rows: [{ label: 'Site', value: 'maple.example' }, { label: 'Page', value: 'About' }, { label: 'Change', value: 'New photo' }],
  files: [{ id: 'f1', name: 'team.jpg', type: 'image/jpeg', url: '/api/portal/attachments/f1' }],
  destination: 'This goes to your requests for maple.example.', quote_line: null, urgent_line: null, choose_project: null,
  buttons: { send: 'Send to the team', change: 'Change something' },
};

describe('SummaryCard', () => {
  it('shows the rows, the file, and both buttons; Send calls back', () => {
    const onSend = vi.fn();
    const onChange = vi.fn();
    render(<SummaryCard summary={summary} busy={false} error={null} onSend={onSend} onChange={onChange} />);
    expect(screen.getByText('maple.example')).toBeTruthy();
    expect(screen.getByText('team.jpg')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send to the team' }));
    expect(onSend).toHaveBeenCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Change something' }));
    expect(onChange).toHaveBeenCalled();
  });
  it('blocks Send until a project is chosen when two builds are open', () => {
    const onSend = vi.fn();
    render(<SummaryCard summary={{ ...summary, choose_project: [{ id: 'p1', name: 'Relaunch' }] }} busy={false} error={null} onSend={onSend} onChange={() => {}} />);
    const send = screen.getByRole('button', { name: 'Send to the team' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Which project is this for?'), { target: { value: 'p1' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledWith('p1');
  });
});

describe('small pieces', () => {
  it('the writing bubble carries the server label and hides the dots from assistive tech', () => {
    const { container } = render(<WritingBubble label="Still writing" />);
    expect(screen.getByText('Still writing')).toBeTruthy();
    expect(container.querySelector('.dots')?.getAttribute('aria-hidden')).toBe('true');
  });
  it('the disclosure line and the handoff banner render their fixed words', () => {
    render(<><DisclosureLine /><HandoffBanner text="A person on the team will reply here." /></>);
    expect(screen.getByTestId('chat-disclosure').textContent).toMatch(/written by an AI assistant/);
    expect(screen.getByText('A person on the team will reply here.')).toBeTruthy();
  });
  it('an attachment chip can be removed and shows progress while uploading', () => {
    const onRemove = vi.fn();
    render(<ul><AttachmentChip draft={{ key: 'k', name: 'a.png', size: 1000, type: 'image/png', preview: null, progress: 40, id: null, error: null }} onRemove={onRemove} /></ul>);
    expect(screen.getByText('Uploading 40%')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove a.png' }));
    expect(onRemove).toHaveBeenCalled();
  });
  it('choice buttons send the slot and id', () => {
    const onChoose = vi.fn();
    render(<ChoiceButtons slot="page" label="Which page?" choices={[{ id: 'p1', label: 'About' }, { id: 'another_page', label: 'Another page' }]} onChoose={onChoose} />);
    fireEvent.click(screen.getByRole('button', { name: /About/ }));
    expect(onChoose).toHaveBeenCalledWith('page', 'p1', 'About');
  });
  it('mergeMessages dedupes by id and keeps time order', () => {
    const m = (id: string, t: string): ChatMessage => ({ id, who: 'client', mine: true, name: 'A', text: id, created_at: t, sources: [], attachments: [] });
    const out = mergeMessages([m('a', '2026-10-21T10:00:00Z')], [m('b', '2026-10-21T10:01:00Z'), m('a', '2026-10-21T10:00:00Z')]);
    expect(out.map((x) => x.id)).toEqual(['a', 'b']);
  });
  it('pulls the drafted reply out of the handoff note', () => {
    expect(extractDraft('Assistant handed this to a person: money.\nDraft reply (not sent):\nHello Dana.')).toBe('Hello Dana.');
    expect(extractDraft('Draft reply (not sent; draft breaks the copy rules):\n(none)')).toBeNull();
  });
});
