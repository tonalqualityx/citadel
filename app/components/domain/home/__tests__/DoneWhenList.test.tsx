import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DoneWhenList, CHECKLIST_SAVED_LINE } from '../DoneWhenList';

const items = [
  { text: 'Rule: nine or ten trustees', done: false, id: 'r1' },
  { text: 'Send the draft', done: true, id: 'r2', answer: 'Done by phone' },
];
const mk = (over = {}) => ({ taskId: 't1', items, onTick: vi.fn().mockResolvedValue(true), onAnswer: vi.fn().mockResolvedValue(true), onNote: vi.fn().mockResolvedValue(true), ...over });

describe('DoneWhenList', () => {
  it('shows labelled real checkboxes with their state', () => {
    render(<DoneWhenList {...mk()} />);
    expect((screen.getByLabelText('Rule: nine or ten trustees') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Send the draft') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(CHECKLIST_SAVED_LINE)).toBeTruthy();
  });
  it('ticks optimistically and calls the handler', async () => {
    const p = mk();
    render(<DoneWhenList {...p} />);
    const box = screen.getByLabelText('Rule: nine or ten trustees') as HTMLInputElement;
    fireEvent.click(box);
    expect(box.checked).toBe(true);
    await waitFor(() => expect(p.onTick).toHaveBeenCalledWith('t1', 'r1', true));
  });
  it('rolls back when the save fails', async () => {
    const p = mk({ onTick: vi.fn().mockResolvedValue(false) });
    render(<DoneWhenList {...p} />);
    const box = screen.getByLabelText('Rule: nine or ten trustees') as HTMLInputElement;
    fireEvent.click(box);
    await waitFor(() => expect(box.checked).toBe(false));
  });
  it('Answer only on unticked rows; Save sends the answer and shows (answered) with the text', async () => {
    const p = mk();
    render(<DoneWhenList {...p} />);
    expect(screen.getAllByText('Answer')).toHaveLength(1);
    fireEvent.click(screen.getByText('Answer'));
    fireEvent.change(screen.getByLabelText('Your answer: Rule: nine or ten trustees'), { target: { value: 'Ten' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(p.onAnswer).toHaveBeenCalledWith('t1', 'r1', 'Ten'));
    await waitFor(() => expect(screen.getByText('Ten')).toBeTruthy());
    expect((screen.getByLabelText('Rule: nine or ten trustees') as HTMLInputElement).checked).toBe(true);
    expect(screen.getAllByText('(answered)').length).toBe(2);
  });
  it('a failed answer keeps the box open and the row unticked', async () => {
    const p = mk({ onAnswer: vi.fn().mockResolvedValue(false) });
    render(<DoneWhenList {...p} />);
    fireEvent.click(screen.getByText('Answer'));
    fireEvent.change(screen.getByLabelText('Your answer: Rule: nine or ten trustees'), { target: { value: 'Ten' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(p.onAnswer).toHaveBeenCalled());
    expect((screen.getByLabelText('Rule: nine or ten trustees') as HTMLInputElement).checked).toBe(false);
    expect(screen.getByLabelText('Your answer: Rule: nine or ten trustees')).toBeTruthy();
  });
  it('the general note only stores a note', async () => {
    const p = mk();
    render(<DoneWhenList {...p} />);
    fireEvent.change(screen.getByLabelText('Note for this task'), { target: { value: 'Call Gene' } });
    fireEvent.click(screen.getByText('Save note'));
    await waitFor(() => expect(p.onNote).toHaveBeenCalledWith('t1', 'Call Gene'));
    expect(p.onTick).not.toHaveBeenCalled();
    expect(p.onAnswer).not.toHaveBeenCalled();
  });
  it('without handlers, or for items with no id, stays display only', () => {
    render(<DoneWhenList taskId="t1" items={[{ text: 'A', done: false }, { text: 'B', done: true }]} />);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.queryByText('Answer')).toBeNull();
  });
});
