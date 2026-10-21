import { describe, it, expect } from 'vitest';
import { DEFAULT_PLAN_LABEL, engagementOf, engagementText, planLabel } from '../engagement';

describe('engagementOf', () => {
  it('a task with a project is a Project, even if it also has a charter', () => {
    const e = engagementOf({ project_id: 'p1', project: { id: 'p1', name: 'Relaunch' }, charter_id: 'c1' });
    expect(e).toEqual({ kind: 'project', label: 'Relaunch', href: '/portal/projects/p1' });
    expect(engagementText(e)).toBe('Project: Relaunch');
  });

  it('a task with a charter and no project is a Retainer labeled by its wares, never the internal name', () => {
    const e = engagementOf({ charter_id: 'c1', charter: { id: 'c1', ware_names: ['SEO', 'Social'] } });
    expect(e.kind).toBe('retainer');
    expect(e.label).toBe('SEO, Social');
    expect(e.href).toBe('/portal/retainer');
    expect(engagementText(e)).toBe('Retainer: SEO, Social');
  });

  it('falls back to "Marketing plan" when no ware names are known', () => {
    expect(engagementOf({ charter_id: 'c1' }).label).toBe(DEFAULT_PLAN_LABEL);
    expect(planLabel([])).toBe(DEFAULT_PLAN_LABEL);
    expect(planLabel([' ', ''])).toBe(DEFAULT_PLAN_LABEL);
  });

  it('anything else is a Request, labeled by the site', () => {
    const e = engagementOf({ site: { id: 's1', name: 'example.com' } });
    expect(e).toEqual({ kind: 'request', label: 'example.com', href: '/portal/requests?site_id=s1' });
    expect(engagementText(e)).toBe('Request: example.com');
  });

  it('a request with no site reads just "Request" and links to the list', () => {
    const e = engagementOf({});
    expect(e).toEqual({ kind: 'request', label: 'Request', href: '/portal/requests' });
    expect(engagementText(e)).toBe('Request');
  });

  it('uses the project id when the name is not loaded', () => {
    expect(engagementOf({ project_id: 'p9' })).toMatchObject({ kind: 'project', label: 'Project', href: '/portal/projects/p9' });
  });
});
