import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { CoverBand } from '../CoverBand';
import { COVERS_ENABLED } from '@/lib/config/feature-flags';

// Clarity Phase 7 (repair, 2026-07-27) — Mike's verdict on tonight's build: covers render
// as broken gray smears at real card sizes. Gated OFF by a single flag
// (lib/config/feature-flags.ts) until the design is fixed — this is the real, unmocked
// import, proving the shipped default is actually off (CoverBand.test.tsx mocks the flag
// to `true` to keep exercising the component's own render logic).
describe('CoverBand — default flag state (Clarity Phase 7 repair)', () => {
  it('the flag defaults to false', () => {
    expect(COVERS_ENABLED).toBe(false);
  });

  it('renders nothing even with a valid coverUrl, because covers are OFF by default', () => {
    const { container } = render(<CoverBand coverUrl="/covers/example.jpg" itemId="item-1" />);
    expect(container).toBeEmptyDOMElement();
  });
});
