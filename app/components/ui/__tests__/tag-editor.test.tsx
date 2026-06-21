import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';

import { TagEditor } from '../tag-editor';

/**
 * TagEditor is the editable counterpart to the read-only TagChips. It powers SOP tag management
 * (and is reusable elsewhere). These tests cover add (Enter + button), remove, dedupe, and
 * empty-input handling.
 */
describe('TagEditor', () => {
  it('renders existing tags as chips', () => {
    render(<TagEditor tags={['stack:eleventy', 'kind:setup']} onChange={vi.fn()} />);
    // parseTag prettifies the value portion: "eleventy" -> "Eleventy", "setup" -> "Setup".
    expect(screen.getByText('Eleventy')).toBeInTheDocument();
    expect(screen.getByText('Setup')).toBeInTheDocument();
  });

  it('adds a tag when pressing Enter', () => {
    const onChange = vi.fn();
    render(<TagEditor tags={['existing']} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.change(input, { target: { value: 'new-tag' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['existing', 'new-tag']);
  });

  it('adds a tag via the Add button', () => {
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.change(input, { target: { value: 'stack:wordpress' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    expect(onChange).toHaveBeenCalledWith(['stack:wordpress']);
  });

  it('trims whitespace and ignores empty input', () => {
    const onChange = vi.fn();
    render(<TagEditor tags={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Add a tag…');
    // Whitespace only -> nothing added.
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    // Padded value -> trimmed.
    fireEvent.change(input, { target: { value: '  spaced  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['spaced']);
  });

  it('dedupes case-insensitively without calling onChange', () => {
    const onChange = vi.fn();
    render(<TagEditor tags={['Stack:X']} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.change(input, { target: { value: 'stack:x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('removes a tag via its X button', () => {
    const onChange = vi.fn();
    render(<TagEditor tags={['stack:eleventy', 'kind:setup']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove tag stack:eleventy'));
    expect(onChange).toHaveBeenCalledWith(['kind:setup']);
  });

  it('removes the last tag on Backspace when input is empty', () => {
    const onChange = vi.fn();
    render(<TagEditor tags={['a', 'b']} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['a']);
  });
});
