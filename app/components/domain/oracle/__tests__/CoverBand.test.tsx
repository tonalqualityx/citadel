import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CoverBand } from '../CoverBand';

// Clarity Phase 7 (repair) — covers are gated OFF by default in the shipped app (see
// lib/config/feature-flags.ts and CoverBand.flag.test.tsx for that default-off contract).
// This file exercises CoverBand's own render/fallback logic, which must still be correct
// once the flag is on — so the whole suite forces it on rather than asserting on markup
// that never renders in production today.
vi.mock('@/lib/config/feature-flags', () => ({ COVERS_ENABLED: true }));

describe('CoverBand', () => {
  it('renders nothing when coverUrl is null', () => {
    const { container } = render(<CoverBand coverUrl={null} itemId="item-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when coverUrl is undefined', () => {
    const { container } = render(<CoverBand coverUrl={undefined} itemId="item-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an img with the given coverUrl', () => {
    render(<CoverBand coverUrl="/covers/example.jpg" itemId="item-1" />);
    const img = screen.getByTestId('card-cover-band').querySelector('img');
    expect(img).toHaveAttribute('src', '/covers/example.jpg');
  });

  it('is aria-hidden and carries no alt text (purely decorative, never conveys meaning)', () => {
    render(<CoverBand coverUrl="/covers/example.jpg" itemId="item-1" />);
    expect(screen.getByTestId('card-cover-band')).toHaveAttribute('aria-hidden', 'true');
    const img = screen.getByTestId('card-cover-band').querySelector('img');
    expect(img).toHaveAttribute('alt', '');
  });

  it('swaps to a generated data-URI cover when the image fails to load', () => {
    render(<CoverBand coverUrl="/covers/broken.jpg" itemId="item-1" />);
    const img = screen.getByTestId('card-cover-band').querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(img.src).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it('the runtime fallback is deterministic — the same itemId always produces the same generated cover', () => {
    const { container: containerA, unmount: unmountA } = render(
      <CoverBand coverUrl="/covers/broken.jpg" itemId="stable-item" />
    );
    const imgA = containerA.querySelector('img') as HTMLImageElement;
    fireEvent.error(imgA);
    const srcA = imgA.src;
    unmountA();

    const { container: containerB } = render(<CoverBand coverUrl="/covers/broken.jpg" itemId="stable-item" />);
    const imgB = containerB.querySelector('img') as HTMLImageElement;
    fireEvent.error(imgB);

    expect(imgB.src).toBe(srcA);
  });
});
