import { describe, it, expect } from 'vitest';
import { buildListLimitParams } from '../use-dashboard';

describe('buildListLimitParams', () => {
  it('returns an empty string when no counts are loaded', () => {
    expect(buildListLimitParams({})).toBe('');
  });

  it('emits a limit_<list> param for a single loaded list', () => {
    expect(buildListLimitParams({ focusTasks: 20 })).toBe('&limit_focusTasks=20');
  });

  it('emits a param for each loaded list', () => {
    const result = buildListLimitParams({ focusTasks: 20, awaitingReview: 30 });
    expect(result).toContain('&limit_focusTasks=20');
    expect(result).toContain('&limit_awaitingReview=30');
  });

  it('omits lists with zero or undefined counts', () => {
    expect(buildListLimitParams({ focusTasks: 0, myTasks: undefined })).toBe('');
  });

  it('keeps only the positive counts when mixed', () => {
    expect(buildListLimitParams({ focusTasks: 0, myTasks: 10 })).toBe('&limit_myTasks=10');
  });
});
