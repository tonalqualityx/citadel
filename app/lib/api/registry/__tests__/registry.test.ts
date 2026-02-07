import { describe, it, expect } from 'vitest';
import { apiRegistry, apiEnums, apiInfo } from '../index';
import type { ApiEndpoint, MethodDef } from '../index';

describe('API Registry', () => {
  describe('structure integrity', () => {
    it('exports a non-empty array of endpoints', () => {
      expect(Array.isArray(apiRegistry)).toBe(true);
      expect(apiRegistry.length).toBeGreaterThan(50);
    });

    it('every endpoint has a path starting with /api/', () => {
      for (const endpoint of apiRegistry) {
        expect(endpoint.path).toMatch(/^\/api\//);
      }
    });

    it('every endpoint has a group field', () => {
      for (const endpoint of apiRegistry) {
        expect(endpoint.group).toBeTruthy();
        expect(typeof endpoint.group).toBe('string');
      }
    });

    it('every endpoint has at least one method', () => {
      for (const endpoint of apiRegistry) {
        expect(endpoint.methods.length).toBeGreaterThan(0);
      }
    });

    it('every method has required fields: method, summary, auth', () => {
      for (const endpoint of apiRegistry) {
        for (const method of endpoint.methods) {
          expect(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']).toContain(method.method);
          expect(typeof method.summary).toBe('string');
          expect(method.summary.length).toBeGreaterThan(0);
          expect(['required', 'none', 'cron']).toContain(method.auth);
        }
      }
    });

    it('no duplicate paths', () => {
      const paths = apiRegistry.map(e => e.path);
      const uniquePaths = new Set(paths);
      const duplicates = paths.filter((p, i) => paths.indexOf(p) !== i);
      expect(duplicates).toEqual([]);
    });
  });

  describe('group coverage', () => {
    const expectedGroups = [
      'auth', 'dashboard', 'clients', 'projects', 'tasks',
      'time-entries', 'sites', 'sops', 'users', 'billing',
      'reference', 'admin', 'misc',
    ];

    it('contains all expected groups', () => {
      const groups = [...new Set(apiRegistry.map(e => e.group))];
      for (const group of expectedGroups) {
        expect(groups).toContain(group);
      }
    });

    it('does not contain unexpected groups', () => {
      const groups = [...new Set(apiRegistry.map(e => e.group))];
      for (const group of groups) {
        expect(expectedGroups).toContain(group);
      }
    });
  });

  describe('response shapes', () => {
    it('most GET methods have a responseExample', () => {
      const getMethods: { path: string; method: MethodDef }[] = [];
      for (const endpoint of apiRegistry) {
        for (const method of endpoint.methods) {
          if (method.method === 'GET') {
            getMethods.push({ path: endpoint.path, method });
          }
        }
      }

      const withExample = getMethods.filter(m => m.method.responseExample);
      // Allow a small number without (e.g. database export returns SQL, not JSON)
      const coveragePercent = (withExample.length / getMethods.length) * 100;
      expect(coveragePercent).toBeGreaterThan(90);
    });

    it('responseExample values are objects (not primitives)', () => {
      for (const endpoint of apiRegistry) {
        for (const method of endpoint.methods) {
          if (method.responseExample) {
            expect(typeof method.responseExample).toBe('object');
            expect(method.responseExample).not.toBeNull();
          }
        }
      }
    });

    it('responseNotes are strings when present', () => {
      for (const endpoint of apiRegistry) {
        for (const method of endpoint.methods) {
          if (method.responseNotes !== undefined) {
            expect(typeof method.responseNotes).toBe('string');
            expect(method.responseNotes.length).toBeGreaterThan(0);
          }
        }
      }
    });
  });

  describe('param definitions', () => {
    it('queryParams have valid structure when present', () => {
      for (const endpoint of apiRegistry) {
        for (const method of endpoint.methods) {
          if (method.queryParams) {
            for (const param of method.queryParams) {
              expect(typeof param.name).toBe('string');
              expect(typeof param.description).toBe('string');
              expect(typeof param.required).toBe('boolean');
              expect(['string', 'number', 'boolean', 'uuid', 'ISO-8601', 'string[]', 'object', 'file']).toContain(param.type);
            }
          }
        }
      }
    });

    it('bodySchema have valid structure when present', () => {
      for (const endpoint of apiRegistry) {
        for (const method of endpoint.methods) {
          if (method.bodySchema) {
            for (const param of method.bodySchema) {
              expect(typeof param.name).toBe('string');
              expect(typeof param.description).toBe('string');
              expect(typeof param.required).toBe('boolean');
              expect(['string', 'number', 'boolean', 'uuid', 'ISO-8601', 'string[]', 'object', 'file']).toContain(param.type);
            }
          }
        }
      }
    });
  });

  describe('key endpoints exist', () => {
    const requiredPaths = [
      '/api/auth/login',
      '/api/auth/me',
      '/api/api-keys',
      '/api/clients',
      '/api/clients/:id',
      '/api/projects',
      '/api/projects/:id',
      '/api/tasks',
      '/api/tasks/:id',
      '/api/time-entries',
      '/api/time-entries/start',
      '/api/users',
      '/api/sites',
      '/api/domains',
      '/api/sops',
      '/api/docs',
      '/api/search',
      '/api/dashboard',
    ];

    it.each(requiredPaths)('%s is registered', (path) => {
      const found = apiRegistry.find(e => e.path === path);
      expect(found).toBeDefined();
    });
  });

  describe('apiEnums', () => {
    it('has all expected enum keys', () => {
      expect(apiEnums.userRoles).toBeDefined();
      expect(apiEnums.projectStatuses).toBeDefined();
      expect(apiEnums.taskStatuses).toBeDefined();
      expect(apiEnums.mysteryFactors).toBeDefined();
      expect(apiEnums.batteryImpacts).toBeDefined();
      expect(apiEnums.clientStatuses).toBeDefined();
    });
  });

  describe('apiInfo', () => {
    it('has auth, pagination, and softDeletes fields', () => {
      expect(apiInfo.auth).toBeDefined();
      expect(apiInfo.auth.header).toContain('Bearer');
      expect(apiInfo.pagination).toBeDefined();
      expect(apiInfo.softDeletes).toBeDefined();
      expect(apiInfo.ids).toBeDefined();
    });
  });
});
