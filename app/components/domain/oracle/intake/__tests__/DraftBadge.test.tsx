import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { DraftBadge } from '../DraftBadge';

const NOW = new Date('2026-10-15T12:00:00Z');

describe('DraftBadge', () => {
  it('renders a Gmail link', () => {
    const url = 'https://mail.google.com/mail/u/?authuser=a%40b.com#all/T1';
    render(<DraftBadge marker={{ at: '2026-10-14T13:00:00Z', url }} timezone="UTC" now={NOW} />);
    expect(screen.getByTestId('draft-badge')).toHaveAttribute('href', url);
  });

  it.each(['javascript:alert(1)', 'https://evil.example/x', 'http://mail.google.com/x', ''])(
    'renders nothing for a non-Gmail url (%s)',
    (url) => {
      render(<DraftBadge marker={{ at: '2026-10-14T13:00:00Z', url }} timezone="UTC" now={NOW} />);
      expect(screen.queryByTestId('draft-badge')).not.toBeInTheDocument();
    },
  );
});
