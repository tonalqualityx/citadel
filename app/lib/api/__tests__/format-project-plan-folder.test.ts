import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Module from 'node:module';
import { formatProjectResponse } from '../formatters';

// formatProjectResponse lazy-loads its calculators with a native require('@/lib/...'),
// which neither vi.mock nor vitest's alias config intercepts. Stub those two requests at
// the CJS loader so this test isolates serialization (and never touches prisma).
const stubs: Record<string, unknown> = {
  '@/lib/calculations/energy': {
    calculateProjectEstimates: () => ({ estimatedHoursMin: 0, estimatedHoursMax: 0 }),
  },
  '@/lib/calculations/project-health': {
    calculateHealthFromTasks: () => ({ status: 'on_track' }),
  },
};

type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const originalLoad = loader._load;

beforeAll(() => {
  loader._load = function (request: string, ...rest: unknown[]) {
    if (request in stubs) return stubs[request];
    return originalLoad.call(this, request, ...rest);
  };
});

afterAll(() => {
  loader._load = originalLoad;
});

const baseProject = {
  id: 'proj-1',
  name: 'Test Project',
  status: 'in_progress',
  type: 'project',
  tasks: [],
  created_at: new Date('2026-10-20T00:00:00Z'),
  updated_at: new Date('2026-10-20T00:00:00Z'),
};

describe('formatProjectResponse plan_folder', () => {
  it('passes plan_folder through', () => {
    const result = formatProjectResponse({
      ...baseProject,
      plan_folder: '/home/mike/Documents/projects/acme',
    });
    expect(result.plan_folder).toBe('/home/mike/Documents/projects/acme');
  });

  it('defaults plan_folder to null when null or missing', () => {
    expect(formatProjectResponse({ ...baseProject, plan_folder: null }).plan_folder).toBeNull();
    expect(formatProjectResponse(baseProject).plan_folder).toBeNull();
  });
});
