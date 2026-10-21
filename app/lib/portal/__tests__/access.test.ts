import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: { findFirst: vi.fn() },
    client: { findFirst: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import {
  canActOnWork,
  canSeeAnalytics,
  canSeeBilling,
  deriveContactPortalFields,
  effectiveClientRole,
  effectiveProjectRole,
  loadPortalAccess,
  maxRole,
  projectAccessScope,
  projectAccessWhere,
  taskAccessWhere,
  type PortalRole,
  type PortalVisibility,
} from '../access';

const mockContactFindFirst = prisma.clientContact.findFirst as Mock;
const mockClientFindFirst = prisma.client.findFirst as Mock;

beforeEach(() => {
  vi.clearAllMocks();
});

const ROLES: PortalRole[] = ['owner', 'member', 'viewer', 'none'];
const VISIBILITIES: PortalVisibility[] = ['inherit', 'restricted', 'hidden'];
const GRANTS: Array<PortalRole | null> = [null, 'viewer', 'member'];

// Expected effective project role, written out as an explicit table (visibility x client role x grant)
// rather than derived from the implementation.
function expected(visibility: PortalVisibility, role: PortalRole, grant: PortalRole | null): PortalRole {
  if (visibility === 'hidden') return 'none';
  const rank = { none: 0, viewer: 1, member: 2, owner: 3 } as const;
  const base: PortalRole = visibility === 'inherit' ? role : role === 'owner' ? 'owner' : 'none';
  const g: PortalRole = grant ?? 'none';
  return rank[base] >= rank[g] ? base : g;
}

describe('effectiveProjectRole: visibility x role x grant', () => {
  for (const visibility of VISIBILITIES)
    for (const role of ROLES)
      for (const grant of GRANTS) {
        it(`${visibility} / client ${role} / grant ${grant ?? 'none'} -> ${expected(visibility, role, grant)}`, () => {
          expect(effectiveProjectRole({ clientRole: role, visibility, grantRole: grant })).toBe(
            expected(visibility, role, grant)
          );
        });
      }

  it('hidden shuts out everyone, owners and granted contacts included', () => {
    for (const role of ROLES)
      for (const grant of GRANTS)
        expect(effectiveProjectRole({ clientRole: role, visibility: 'hidden', grantRole: grant })).toBe('none');
  });

  it('owners see every non-hidden project, restricted included', () => {
    expect(effectiveProjectRole({ clientRole: 'owner', visibility: 'restricted' })).toBe('owner');
    expect(effectiveProjectRole({ clientRole: 'owner', visibility: 'inherit' })).toBe('owner');
  });

  it('restricted closes a member or viewer unless they hold a grant', () => {
    expect(effectiveProjectRole({ clientRole: 'member', visibility: 'restricted' })).toBe('none');
    expect(effectiveProjectRole({ clientRole: 'viewer', visibility: 'restricted' })).toBe('none');
    expect(effectiveProjectRole({ clientRole: 'viewer', visibility: 'restricted', grantRole: 'viewer' })).toBe('viewer');
  });

  it('grants only raise: a viewer grant never lowers a member, and never lowers an owner', () => {
    expect(effectiveProjectRole({ clientRole: 'member', visibility: 'inherit', grantRole: 'viewer' })).toBe('member');
    expect(effectiveProjectRole({ clientRole: 'owner', visibility: 'inherit', grantRole: 'viewer' })).toBe('owner');
    expect(effectiveProjectRole({ clientRole: 'viewer', visibility: 'inherit', grantRole: 'member' })).toBe('member');
  });

  it('a grant can never confer owner or none (member and viewer only)', () => {
    expect(effectiveProjectRole({ clientRole: 'none', visibility: 'inherit', grantRole: 'owner' })).toBe('none');
    expect(effectiveProjectRole({ clientRole: 'viewer', visibility: 'inherit', grantRole: 'none' })).toBe('viewer');
  });

  it('a project-only contact (client role none) gets exactly the granted role', () => {
    expect(effectiveProjectRole({ clientRole: 'none', visibility: 'inherit', grantRole: 'viewer' })).toBe('viewer');
    expect(effectiveProjectRole({ clientRole: 'none', visibility: 'restricted', grantRole: 'member' })).toBe('member');
  });
});

describe('effectiveClientRole: own client, agency inheritance, sub-client walls', () => {
  const agencyContact = { client_id: 'agency', portal_role: 'owner' as const, is_deleted: false };
  const subContact = { client_id: 'sub-a', portal_role: 'owner' as const, is_deleted: false };

  it('uses the contact role on their own client', () => {
    for (const role of ROLES)
      expect(effectiveClientRole({ client_id: 'c1', portal_role: role }, { id: 'c1' })).toBe(role);
  });

  it('agency contacts inherit their role onto every sub-client', () => {
    for (const role of ROLES) {
      const c = { client_id: 'agency', portal_role: role };
      expect(effectiveClientRole(c, { id: 'sub-a', parent_agency_id: 'agency' })).toBe(role);
      expect(effectiveClientRole(c, { id: 'sub-b', parent_agency_id: 'agency' })).toBe(role);
    }
  });

  it('sub-client contacts see only themselves: not the agency, not a sibling', () => {
    expect(effectiveClientRole(subContact, { id: 'agency', parent_agency_id: null })).toBe('none');
    expect(effectiveClientRole(subContact, { id: 'sub-b', parent_agency_id: 'agency' })).toBe('none');
    expect(effectiveClientRole(subContact, { id: 'sub-a', parent_agency_id: 'agency' })).toBe('owner');
  });

  it('a client under a different agency, or none, gets no inheritance', () => {
    expect(effectiveClientRole(agencyContact, { id: 'other', parent_agency_id: 'other-agency' })).toBe('none');
    expect(effectiveClientRole(agencyContact, { id: 'other', parent_agency_id: null })).toBe('none');
    expect(effectiveClientRole(agencyContact, { id: 'other' })).toBe('none');
  });

  it('a deleted or missing contact has no access anywhere, inheritance included', () => {
    expect(effectiveClientRole({ ...agencyContact, is_deleted: true }, { id: 'agency' })).toBe('none');
    expect(effectiveClientRole({ ...agencyContact, is_deleted: true }, { id: 'sub-a', parent_agency_id: 'agency' })).toBe('none');
    expect(effectiveClientRole(null, { id: 'agency' })).toBe('none');
    expect(effectiveClientRole(undefined, { id: 'agency' })).toBe('none');
  });
});

describe('capabilities', () => {
  it('billing is owner-only', () => {
    expect(ROLES.filter(canSeeBilling)).toEqual(['owner']);
  });
  it('analytics need any client-level role', () => {
    expect(ROLES.filter(canSeeAnalytics)).toEqual(['owner', 'member', 'viewer']);
  });
  it('owner and member may act on work', () => {
    expect(ROLES.filter(canActOnWork)).toEqual(['owner', 'member']);
  });
  it('maxRole picks the higher rank', () => {
    expect(maxRole('viewer', 'member')).toBe('member');
    expect(maxRole('owner', 'none')).toBe('owner');
    expect(maxRole('none', 'none')).toBe('none');
  });
});

describe('deriveContactPortalFields: role and can_initiate_work never disagree', () => {
  it.each([
    ['owner', true],
    ['member', true],
    ['viewer', false],
    ['none', false],
  ] as const)('portal_role %s -> can_initiate_work %s, even against a conflicting flag', (role, flag) => {
    expect(deriveContactPortalFields({ portal_role: role })).toEqual({ portal_role: role, can_initiate_work: flag });
    expect(deriveContactPortalFields({ portal_role: role, can_initiate_work: !flag })).toEqual({
      portal_role: role,
      can_initiate_work: flag,
    });
  });

  it('legacy flag alone: true lifts viewer/none to member, false lowers owner/member to viewer', () => {
    expect(deriveContactPortalFields({ can_initiate_work: true }, 'viewer')).toEqual({ portal_role: 'member', can_initiate_work: true });
    expect(deriveContactPortalFields({ can_initiate_work: true }, 'none')).toEqual({ portal_role: 'member', can_initiate_work: true });
    expect(deriveContactPortalFields({ can_initiate_work: false }, 'owner')).toEqual({ portal_role: 'viewer', can_initiate_work: false });
    expect(deriveContactPortalFields({ can_initiate_work: false }, 'member')).toEqual({ portal_role: 'viewer', can_initiate_work: false });
  });

  it('legacy flag that already matches the role keeps the role (owner stays owner)', () => {
    expect(deriveContactPortalFields({ can_initiate_work: true }, 'owner')).toEqual({ portal_role: 'owner', can_initiate_work: true });
    expect(deriveContactPortalFields({ can_initiate_work: false }, 'none')).toEqual({ portal_role: 'none', can_initiate_work: false });
  });

  it('writes nothing when neither field is sent', () => {
    expect(deriveContactPortalFields({}, 'owner')).toEqual({});
  });
});

describe('Prisma where builders', () => {
  const base = { contactId: 'k1', clientId: 'c1' };

  it('owner: every non-hidden project, no grant needed', () => {
    expect(projectAccessScope({ ...base, role: 'owner' })).toEqual({ portal_visibility: { not: 'hidden' } });
  });

  it('member/viewer: inherit projects or a grant, never hidden', () => {
    for (const role of ['member', 'viewer'] as const) {
      const scope = projectAccessScope({ ...base, role }) as any;
      expect(scope.AND[0]).toEqual({ portal_visibility: { not: 'hidden' } });
      expect(scope.AND[1].OR).toEqual([
        { portal_visibility: 'inherit' },
        { contact_grants: { some: { contact_id: 'k1', role: { in: ['member', 'viewer'] } } } },
      ]);
    }
  });

  it('none: only granted, non-hidden projects', () => {
    const scope = projectAccessScope({ ...base, role: 'none' }) as any;
    expect(scope.AND).toEqual([
      { portal_visibility: { not: 'hidden' } },
      { contact_grants: { some: { contact_id: 'k1', role: { in: ['member', 'viewer'] } } } },
    ]);
  });

  it('projectAccessWhere pins the client, drops deleted and quote/queue projects', () => {
    const where = projectAccessWhere({ ...base, role: 'owner' });
    expect(where).toMatchObject({
      client_id: 'c1',
      is_deleted: false,
      status: { notIn: ['quote', 'queue'] },
    });
  });

  it('taskAccessWhere: client roles also see project-less tasks, project-only contacts do not', () => {
    const owner = taskAccessWhere({ ...base, role: 'owner' }) as any;
    expect(owner.OR[0]).toEqual({ project_id: null });
    const none = taskAccessWhere({ ...base, role: 'none' }) as any;
    expect(none).not.toHaveProperty('OR');
    expect(none.project).toEqual(projectAccessScope({ ...base, role: 'none' }));
  });
});

describe('loadPortalAccess', () => {
  const base = { contactId: 'k1', clientId: 'c1' };
  const session = { contactId: 'k1', clientId: 'c1' };

  it('flags a deleted contact as revoked, and both where-builders then match nothing', async () => {
    mockContactFindFirst.mockResolvedValue(null);
    const access = await loadPortalAccess(session);
    expect(access).toMatchObject({ role: 'none', revoked: true });
    expect(projectAccessScope(access)).toEqual({ id: { in: [] } });
    expect(projectAccessWhere(access).AND).toEqual([{ id: { in: [] } }]);
    expect(taskAccessWhere(access)).toEqual({ id: { in: [] } });
  });

  it('revoked beats a role: even an owner-shaped revoked access matches nothing', () => {
    const access = { ...base, role: 'owner' as const, revoked: true };
    expect(projectAccessScope(access)).toEqual({ id: { in: [] } });
    expect(taskAccessWhere(access)).toEqual({ id: { in: [] } });
  });

  it('own client: one query, contact role applies', async () => {
    mockContactFindFirst.mockResolvedValue({ client_id: 'c1', portal_role: 'member', is_deleted: false });
    expect(await loadPortalAccess(session)).toEqual({ contactId: 'k1', clientId: 'c1', role: 'member' });
    expect(mockClientFindFirst).not.toHaveBeenCalled();
    expect(mockContactFindFirst.mock.calls[0][0].where).toEqual({ id: 'k1', is_deleted: false });
  });

  it('deleted contact (filtered out by the query) is role none', async () => {
    mockContactFindFirst.mockResolvedValue(null);
    expect((await loadPortalAccess(session)).role).toBe('none');
  });

  it('agency contact on a sub-client inherits the role', async () => {
    mockContactFindFirst.mockResolvedValue({ client_id: 'agency', portal_role: 'owner', is_deleted: false });
    mockClientFindFirst.mockResolvedValue({ id: 'c1', parent_agency_id: 'agency' });
    expect((await loadPortalAccess(session)).role).toBe('owner');
  });

  it('sub-client contact pointed at the agency or a sibling gets none', async () => {
    mockContactFindFirst.mockResolvedValue({ client_id: 'sub-a', portal_role: 'owner', is_deleted: false });
    mockClientFindFirst.mockResolvedValue({ id: 'c1', parent_agency_id: 'agency' });
    expect((await loadPortalAccess(session)).role).toBe('none');
  });

  it('an active client that no longer resolves is role none', async () => {
    mockContactFindFirst.mockResolvedValue({ client_id: 'agency', portal_role: 'owner', is_deleted: false });
    mockClientFindFirst.mockResolvedValue(null);
    expect((await loadPortalAccess(session)).role).toBe('none');
  });
});
