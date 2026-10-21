import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Mock } from 'vitest';

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    clientContact: { findMany: vi.fn(), findFirst: vi.fn() },
    client: { findMany: vi.fn(), findFirst: vi.fn() },
    projectContact: { findMany: vi.fn() },
  },
}));

import { prisma } from '@/lib/db/prisma';
import { buildAccessibleClients, resolveAccessibleClients, loadPortalAccess } from '../access';
import { FakePortalDb } from './fake-portal-db';

const db = new FakePortalDb();

beforeEach(() => {
  vi.clearAllMocks();
  db.reset();
  db.install(prisma as unknown as Record<string, Record<string, Mock>>);
  // Nerd Herd (agency) with two sub-clients; a direct client; a second direct client.
  db.addClient({ id: 'nh', name: 'Nerd Herd', type: 'agency_partner' });
  db.addClient({ id: 'sub-a', name: 'Sub A', type: 'sub_client', parent_agency_id: 'nh' });
  db.addClient({ id: 'sub-b', name: 'Sub B', type: 'sub_client', parent_agency_id: 'nh' });
  db.addClient({ id: 'acme', name: 'Acme', type: 'direct' });
  db.addClient({ id: 'other', name: 'Other', type: 'direct' });
});

const ids = (rows: Array<{ clientId: string }>) => rows.map((r) => r.clientId).sort();

describe('resolveAccessibleClients', () => {
  it('agency member lists the agency and every sub-client, with the agency role on each', async () => {
    db.addContact({ id: 'k-nh', client_id: 'nh', email: 'Pat@NerdHerd.com', portal_role: 'member' });
    const rows = await resolveAccessibleClients('pat@nerdherd.com');
    expect(ids(rows)).toEqual(['nh', 'sub-a', 'sub-b']);
    expect(rows.every((r) => r.role === 'member')).toBe(true);
    expect(rows.find((r) => r.clientId === 'sub-a')).toMatchObject({ via: 'agency', contactId: 'k-nh' });
    expect(rows.find((r) => r.clientId === 'nh')).toMatchObject({ via: 'direct' });
  });

  it('sub-client contact sees only their own client: not the agency, not a sibling', async () => {
    db.addContact({ id: 'k-sa', client_id: 'sub-a', email: 'sam@suba.com', portal_role: 'owner' });
    const rows = await resolveAccessibleClients('sam@suba.com');
    expect(ids(rows)).toEqual(['sub-a']);
  });

  it('person with two contact rows gets both clients and the right role on each', async () => {
    db.addContact({ id: 'k1', client_id: 'acme', email: 'ann@x.com', portal_role: 'viewer' });
    db.addContact({ id: 'k2', client_id: 'other', email: 'ANN@x.com', portal_role: 'owner' });
    const rows = await resolveAccessibleClients('ann@x.com');
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.clientId === 'acme')).toMatchObject({ role: 'viewer', contactId: 'k1' });
    expect(rows.find((r) => r.clientId === 'other')).toMatchObject({ role: 'owner', contactId: 'k2' });
  });

  it('revoked access drops the client: deleted contact, role none, deleted client', async () => {
    db.addContact({ id: 'k1', client_id: 'acme', email: 'ann@x.com', portal_role: 'viewer' });
    db.addContact({ id: 'k2', client_id: 'other', email: 'ann@x.com', portal_role: 'owner' });
    expect(ids(await resolveAccessibleClients('ann@x.com'))).toEqual(['acme', 'other']);

    db.contacts.find((c) => c.id === 'k2')!.is_deleted = true;
    expect(ids(await resolveAccessibleClients('ann@x.com'))).toEqual(['acme']);

    db.contacts.find((c) => c.id === 'k1')!.portal_role = 'none';
    expect(await resolveAccessibleClients('ann@x.com')).toEqual([]);
  });

  it('losing the agency role drops every inherited sub-client at once', async () => {
    db.addContact({ id: 'k-nh', client_id: 'nh', email: 'pat@nerdherd.com', portal_role: 'owner' });
    expect(await resolveAccessibleClients('pat@nerdherd.com')).toHaveLength(3);
    db.contacts[0].portal_role = 'none';
    expect(await resolveAccessibleClients('pat@nerdherd.com')).toEqual([]);
  });

  it('a deleted sub-client drops out of the agency list', async () => {
    db.addContact({ id: 'k-nh', client_id: 'nh', email: 'pat@nerdherd.com', portal_role: 'member' });
    db.clients.find((c) => c.id === 'sub-b')!.is_deleted = true;
    expect(ids(await resolveAccessibleClients('pat@nerdherd.com'))).toEqual(['nh', 'sub-a']);
  });

  it('project-only contact: client appears at role none, only through a live grant', async () => {
    db.addContact({ id: 'k1', client_id: 'acme', email: 'pro@x.com', portal_role: 'none' });
    db.addProject({ id: 'p1', client_id: 'acme' });
    db.addGrant({ project_id: 'p1', contact_id: 'k1', role: 'viewer' });
    const rows = await resolveAccessibleClients('pro@x.com');
    expect(rows).toEqual([{ clientId: 'acme', name: 'Acme', role: 'none', contactId: 'k1', contactIds: ['k1'], via: 'project' }]);

    db.grants.length = 0; // grant removed
    expect(await resolveAccessibleClients('pro@x.com')).toEqual([]);
  });

  it('a grant on a hidden project or a pre-kickoff project does not surface the client', async () => {
    db.addContact({ id: 'k1', client_id: 'acme', email: 'pro@x.com', portal_role: 'none' });
    db.addProject({ id: 'ph', client_id: 'acme', portal_visibility: 'hidden' });
    db.addProject({ id: 'pq', client_id: 'acme', status: 'queue' });
    db.addGrant({ project_id: 'ph', contact_id: 'k1', role: 'member' });
    db.addGrant({ project_id: 'pq', contact_id: 'k1', role: 'member' });
    expect(await resolveAccessibleClients('pro@x.com')).toEqual([]);
  });

  it('a grant on a deleted or cancelled project does not keep a client reachable (same rule as sign-in)', async () => {
    db.addContact({ id: 'k1', client_id: 'acme', email: 'pro@x.com', portal_role: 'none' });
    db.addProject({ id: 'pd', client_id: 'acme', is_deleted: true });
    db.addProject({ id: 'pc', client_id: 'acme', status: 'cancelled' });
    db.addGrant({ project_id: 'pd', contact_id: 'k1', role: 'member' });
    db.addGrant({ project_id: 'pc', contact_id: 'k1', role: 'member' });
    expect(await resolveAccessibleClients('pro@x.com')).toEqual([]);
  });

  it('agency member plus a sub-client row: grants on the sub-client row apply under the agency entry', async () => {
    db.addContact({ id: 'k-nh', client_id: 'nh', email: 'pat@nerdherd.com', portal_role: 'viewer' });
    db.addContact({ id: 'k-sa', client_id: 'sub-a', email: 'pat@nerdherd.com', portal_role: 'none' });
    db.addProject({ id: 'p-inherit', client_id: 'sub-a' });
    db.addProject({ id: 'p-restricted', client_id: 'sub-a', portal_visibility: 'restricted' });
    db.addGrant({ project_id: 'p-restricted', contact_id: 'k-sa', role: 'viewer' });

    const rows = await resolveAccessibleClients('pat@nerdherd.com');
    const sub = rows.find((r) => r.clientId === 'sub-a')!;
    // The role comes from the agency row; the grant sits on the OTHER row.
    expect(sub).toMatchObject({ role: 'viewer', contactId: 'k-nh', via: 'agency' });
    expect(sub.contactIds.sort()).toEqual(['k-nh', 'k-sa']);

    const access = await loadPortalAccess({ contactId: sub.contactId, contactIds: sub.contactIds, clientId: 'sub-a', role: sub.role });
    const { projectAccessWhere } = await import('../access');
    expect(db.visibleProjectIds(projectAccessWhere(access))).toEqual(['p-inherit', 'p-restricted']);
    // Without carrying all rows, the restricted project would be lost.
    expect(db.visibleProjectIds(projectAccessWhere({ contactId: 'k-nh', clientId: 'sub-a', role: 'viewer' }))).toEqual(['p-inherit']);
  });

  it('empty email resolves nothing', async () => {
    expect(await resolveAccessibleClients('  ')).toEqual([]);
  });
});

describe('buildAccessibleClients ties', () => {
  it('direct role beats an equal inherited role; a higher inherited role beats a lower direct one', () => {
    const client = (id: string) => ({ id, name: id });
    const rows = buildAccessibleClients({
      contacts: [
        { id: 'a', client_id: 'agency', portal_role: 'owner', client: client('agency') },
        { id: 'b', client_id: 'sub', portal_role: 'viewer', client: client('sub') },
      ],
      subClients: [{ id: 'sub', name: 'sub', parent_agency_id: 'agency' }],
      grants: [],
    });
    expect(rows.find((r) => r.clientId === 'sub')).toMatchObject({ role: 'owner', via: 'agency', contactId: 'a' });
  });
});

describe('project-only contact end to end', () => {
  it('signs in via the eligibility filter and sees only the granted projects', async () => {
    db.addContact({ id: 'k1', client_id: 'acme', email: 'pro@x.com', portal_role: 'none' });
    db.addProject({ id: 'p1', client_id: 'acme' });
    db.addProject({ id: 'p2', client_id: 'acme' });
    db.addGrant({ project_id: 'p1', contact_id: 'k1', role: 'member' });

    // Active client resolves at role none; the access object then scopes projects to grants.
    const [entry] = await resolveAccessibleClients('pro@x.com');
    const access = await loadPortalAccess({ contactId: entry.contactId, clientId: entry.clientId, role: entry.role });
    expect(access).toEqual({ contactId: 'k1', clientId: 'acme', role: 'none' });

    const { projectAccessWhere } = await import('../access');
    expect(db.visibleProjectIds(projectAccessWhere(access))).toEqual(['p1']);
  });

  it('with the grant gone the contact has no clients and no visible projects', async () => {
    db.addContact({ id: 'k1', client_id: 'acme', email: 'pro@x.com', portal_role: 'none' });
    db.addProject({ id: 'p1', client_id: 'acme' });
    expect(await resolveAccessibleClients('pro@x.com')).toEqual([]);
    const { projectAccessWhere } = await import('../access');
    expect(db.visibleProjectIds(projectAccessWhere({ contactId: 'k1', clientId: 'acme', role: 'none' }))).toEqual([]);
  });
});
