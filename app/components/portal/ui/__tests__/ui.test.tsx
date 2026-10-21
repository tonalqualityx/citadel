import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { Plus } from 'lucide-react';
import { StatusChip } from '../status-chip';
import { ProgressBar } from '../progress-bar';
import { Sparkline, sparkPoints } from '../sparkline';
import { Callout } from '../callout';
import { EmptyState } from '../empty-state';
import { SegmentedControl } from '../segmented-control';
import { Field } from '../field';
import { Motif, MOTIFS } from '../motifs';
import { StatTile } from '../stat-tile';
import { YearRibbon } from '../year-ribbon';
import { PhaseTrack } from '../phase-track';
import { PortalButton } from '../button';
import type { ChipTone } from '@/lib/portal/status-labels';

vi.mock('next/link', () => ({ default: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }));

describe('StatusChip', () => {
  for (const tone of ['attention', 'moving', 'done', 'quiet', 'urgent', 'quote'] as ChipTone[]) {
    it(`${tone}: an aria-hidden icon plus the label`, () => {
      const { container } = render(<StatusChip tone={tone} label="A word" />);
      const chip = container.querySelector(`[data-tone="${tone}"]`)!;
      expect(chip.textContent).toBe('A word');
      expect(chip.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    });
  }
});

describe('ProgressBar', () => {
  it('always prints "N of M complete"', () => {
    render(<ProgressBar done={14} total={22} />);
    expect(screen.getByText(/14 of 22/).parentElement?.textContent).toMatch(/14 of 22\s+complete/);
  });
  it('prints nothing and hides the bar at 0 of 0', () => {
    const { container } = render(<ProgressBar done={0} total={0} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('Sparkline', () => {
  it('maps the minimum to the bottom and the maximum to the top', () => {
    const pts = sparkPoints([10, 50, 30], 100, 40, 3);
    expect(pts[0][1]).toBe(37);
    expect(pts[1][1]).toBe(3);
    expect(pts[2][1]).toBeGreaterThan(3);
    expect(pts[2][1]).toBeLessThan(37);
  });
  it('is role=img with an aria-label', () => {
    render(<Sparkline series={[1, 2, 3]} label="Visits over 30 days" />);
    expect(screen.getByRole('img', { name: 'Visits over 30 days' })).toBeInTheDocument();
  });
  it('draws nothing for a single point', () => {
    const { container } = render(<Sparkline series={[3]} label="x" />);
    expect(container.firstChild).toBeNull();
  });
});

describe('Callout', () => {
  it('gives the count badge an accessible label', () => {
    render(<Callout icon={Plus} title="Needs you" count={3} id="ny">body</Callout>);
    expect(screen.getByLabelText('3 items')).toHaveTextContent('3');
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument();
  });
  it('says "1 item" for one', () => {
    render(<Callout icon={Plus} title="Needs you" count={1}>x</Callout>);
    expect(screen.getByLabelText('1 item')).toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders the title and the body', () => {
    render(<EmptyState art="meadow" title="Nothing here" body="Come back later." />);
    expect(screen.getByRole('heading', { name: 'Nothing here' })).toBeInTheDocument();
    expect(screen.getByText('Come back later.')).toBeInTheDocument();
  });
  it('the all-clear art is decorative', () => {
    const { container } = render(<EmptyState art="all-clear" title="t" body="b" />);
    expect(container.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
});

describe('SegmentedControl', () => {
  it('sets aria-pressed and reports a change', () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Filter" value="b" onChange={onChange} options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} />);
    expect(screen.getByRole('button', { name: 'B' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    expect(onChange).toHaveBeenCalledWith('a');
  });
});

describe('Field', () => {
  it('wires aria-invalid and aria-describedby on error', () => {
    render(<Field id="e" label="Email" hint="We reply there." error="Enter an email."><input type="email" /></Field>);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input.getAttribute('aria-describedby')).toBe('e-hint e-err');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter an email.');
  });
  it('is not invalid without an error', () => {
    render(<Field id="e" label="Email"><input type="email" /></Field>);
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
  });
});

describe('Motif', () => {
  it('is aria-hidden and not focusable, for every motif', () => {
    for (const name of Object.keys(MOTIFS) as Array<keyof typeof MOTIFS>) {
      const { container, unmount } = render(<Motif name={name} />);
      const svg = container.querySelector('svg')!;
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('focusable', 'false');
      unmount();
    }
  });
});

describe('StatTile', () => {
  it('writes a rise as Up, with the base month', () => {
    render(<StatTile site="a.com" value={8412} label="visits" delta={{ pct: 18, vs: 'September' }} />);
    expect(screen.getByText(/Up 18% on September/)).toBeInTheDocument();
    expect(screen.getByText('8,412')).toBeInTheDocument();
  });
  it('writes a dip as Down, never with an urgent class', () => {
    const { container } = render(<StatTile site="a.com" value={3977} label="visits" delta={{ pct: -6, vs: 'September' }} />);
    expect(screen.getByText(/Down 6% on September/)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/urgent|error|red/);
  });
  it('draws no sparkline without a series', () => {
    const { container } = render(<StatTile site="a.com" value={1} label="visits" />);
    expect(container.querySelector('.spark')).toBeNull();
  });
});

describe('YearRibbon', () => {
  it('has no missed state and says what each month is to a screen reader', () => {
    render(<YearRibbon months={[{ label: 'Apr', state: 'delivered' }, { label: 'May', state: 'past' }, { label: 'Jun', state: 'current' }, { label: 'Jul', state: 'ready' }, { label: 'Aug', state: 'upcoming' }]} />);
    expect(screen.getByText('report delivered')).toBeInTheDocument();
    expect(screen.getByText('plan ready for you')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toMatch(/missed|late|overdue/i);
  });
});

describe('PhaseTrack', () => {
  it('marks the current phase and lists them in order', () => {
    render(<PhaseTrack kind="project" phases={[{ name: 'Discovery', state: 'done' }, { name: 'Content', state: 'current' }, { name: 'Build', state: 'upcoming' }]} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[1].className).toBe('now');
  });
});

describe('PortalButton', () => {
  it('renders a link when given an href and a button otherwise', () => {
    const { rerender } = render(<PortalButton href="/x">Go</PortalButton>);
    expect(screen.getByRole('link', { name: 'Go' })).toHaveAttribute('href', '/x');
    rerender(<PortalButton busy busyLabel="Sending...">Send</PortalButton>);
    expect(screen.getByRole('button')).toBeDisabled();
    expect(screen.getByRole('button')).toHaveTextContent('Sending...');
  });
});
