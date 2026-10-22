import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ChatBubble } from '@/components/portal/intake/chat-bubble';
import { WritingBubble } from '@/components/portal/chat/writing-bubble';
import { IndelibleMark } from '../indelible-mark';

describe('Indelible mark', () => {
  it('paints with currentColor only and takes a size', () => {
    const { container } = render(<IndelibleMark size={32} />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('32');
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}/i);
    expect(container.innerHTML).toContain('currentColor');
  });
  it('is the assistant avatar, not the letter I', () => {
    const { container, queryByTestId } = render(<ChatBubble side="us" who="Indelible assistant" author="assistant">Hi</ChatBubble>);
    expect(queryByTestId('chat-assistant-mark')?.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('.av')?.textContent).toBe('');
  });
  it('keeps the person icon for the team and uses the mark while writing', () => {
    const team = render(<ChatBubble side="us" who="Indelible team" author="team">Hi</ChatBubble>);
    expect(team.queryByTestId('chat-person-mark')).not.toBeNull();
    expect(team.queryByTestId('chat-assistant-mark')).toBeNull();
    const w = render(<WritingBubble label="Writing" />);
    expect(w.container.querySelector('.av svg')).not.toBeNull();
  });
});
