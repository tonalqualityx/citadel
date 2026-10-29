import { describe, it, expect } from 'vitest';
import { computeViewportScale } from '../viewport-scale';

describe('computeViewportScale', () => {
  it('1280 in a 1000px container scales to 78% and keeps the layout width', () => {
    expect(computeViewportScale(1000, 1280)).toMatchObject({ layoutWidth: 1280, scale: 1000 / 1280, percent: 78, scaled: true });
  });
  it('Fit is 100% at the container width', () => {
    expect(computeViewportScale(1000, null)).toEqual({ layoutWidth: 1000, scale: 1, percent: 100, scaled: false });
  });
  it('never scales up', () => {
    expect(computeViewportScale(1600, 1280)).toMatchObject({ layoutWidth: 1280, scale: 1, percent: 100, scaled: false });
    expect(computeViewportScale(400, 390)).toMatchObject({ scale: 1, scaled: false });
  });
  it('an unmeasured container is not scaled', () => {
    expect(computeViewportScale(0, 1280)).toMatchObject({ layoutWidth: 1280, scale: 1, scaled: false });
  });
});
