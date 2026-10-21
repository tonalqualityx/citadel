import { describe, it, expect } from 'vitest';
import { memoizeLookups, resolveOwner, resolvesToMike, roleKeyForFunctionName, MIKE_USER_ID, type OwnerLookups } from './owner';
import { BAST_USER_ID } from '@/lib/oracle/projects/gate-constants';

function lookups(over: Partial<OwnerLookups & { inactive: string[] }> = {}): OwnerLookups & { calls: string[] } {
  const calls: string[] = [];
  const inactive = new Set(over.inactive ?? []);
  return {
    calls,
    isActiveUser: async (id) => {
      calls.push(`active:${id}`);
      return !inactive.has(id);
    },
    functionName: over.functionName ?? (async () => null),
    projectRoleHolder: over.projectRoleHolder ?? (async () => null),
    charterRoleHolder: over.charterRoleHolder ?? (async () => null),
    clientRoleHolder: over.clientRoleHolder ?? (async () => null),
    accordOwner: over.accordOwner ?? (async () => null),
  };
}

describe('resolveOwner order', () => {
  it('stand-in beats the person', async () => {
    const r = await resolveOwner({ stand_in_user_id: 'sabeen', owner_user_id: 'angela' }, lookups());
    expect(r).toMatchObject({ user_id: 'sabeen', source: 'stand_in' });
  });

  it('skips an inactive stand-in and falls through to the person', async () => {
    const r = await resolveOwner({ stand_in_user_id: 'gone', owner_user_id: 'angela' }, lookups({ inactive: ['gone'] }));
    expect(r).toMatchObject({ user_id: 'angela', source: 'person' });
  });

  it('the escalation target is next, ahead of the person', async () => {
    const r = await resolveOwner({ escalated_to_user_id: 'pm1', owner_user_id: 'nils' }, lookups());
    expect(r).toMatchObject({ user_id: 'pm1', source: 'escalated' });
  });

  it('the person beats the role', async () => {
    const r = await resolveOwner(
      { owner_user_id: 'nils', project_id: 'p1', action_payload: { owner_role: 'content' } },
      lookups({ projectRoleHolder: async () => 'someone-else' })
    );
    expect(r).toMatchObject({ user_id: 'nils', source: 'person' });
  });

  it('role holder: project first, then charter, then client team', async () => {
    const base = { project_id: 'p1', charter_id: 'c1', client_id: 'cl1', action_payload: { owner_role: 'pm' } };
    const all = lookups({
      projectRoleHolder: async () => 'pm-project',
      charterRoleHolder: async () => 'pm-charter',
      clientRoleHolder: async () => 'pm-client',
    });
    expect((await resolveOwner(base, all)).source).toBe('role_project');

    const noProject = lookups({ charterRoleHolder: async () => 'pm-charter', clientRoleHolder: async () => 'pm-client' });
    expect(await resolveOwner(base, noProject)).toMatchObject({ user_id: 'pm-charter', source: 'role_charter' });

    const onlyClient = lookups({ clientRoleHolder: async () => 'pm-client' });
    expect(await resolveOwner(base, onlyClient)).toMatchObject({ user_id: 'pm-client', source: 'role_client' });
  });

  it('an inactive role holder is skipped for the next level', async () => {
    const r = await resolveOwner(
      { project_id: 'p1', charter_id: 'c1', action_payload: { owner_role: 'pm' } },
      lookups({ inactive: ['pm-project'], projectRoleHolder: async () => 'pm-project', charterRoleHolder: async () => 'pm-charter' })
    );
    expect(r).toMatchObject({ user_id: 'pm-charter', source: 'role_charter' });
  });

  it('a function on the wait chooses the role over the template default', async () => {
    const seen: string[] = [];
    const r = await resolveOwner(
      { project_id: 'p1', owner_function_id: 'f-design', action_payload: { owner_role: 'content' } },
      lookups({
        functionName: async () => 'Design II',
        projectRoleHolder: async (_p, s) => {
          seen.push(s.role);
          return 'dana';
        },
      })
    );
    expect(seen).toEqual(['design']);
    expect(r).toMatchObject({ user_id: 'dana', source: 'role_project', role_key: 'design' });
  });

  it('sales resolves to the accord owner', async () => {
    const r = await resolveOwner(
      { accord_id: 'a1', action_payload: { owner_role: 'sales' } },
      lookups({ accordOwner: async () => 'owner1' })
    );
    expect(r).toMatchObject({ user_id: 'owner1', source: 'accord_owner' });
  });

  it('sales with no accord is Mike', async () => {
    expect((await resolveOwner({ action_payload: { owner_role: 'sales' } }, lookups())).user_id).toBe(MIKE_USER_ID);
  });

  it('a client-owned wait resolves the liaison, else the template shepherd', async () => {
    const seen: string[] = [];
    const l = lookups({
      projectRoleHolder: async (_p, s) => {
        seen.push(s.role);
        return s.role === 'liaison' ? 'csm' : null;
      },
    });
    const r = await resolveOwner({ owner_contact_id: 'contact1', project_id: 'p1', action_payload: { owner_role: 'client' } }, l);
    expect(r).toMatchObject({ user_id: 'csm', role_key: 'liaison' });
    const pm = await resolveOwner(
      { project_id: 'p1', action_payload: { owner_role: 'client', shepherd_role: 'pm' } },
      lookups({ projectRoleHolder: async (_p, s) => (s.role === 'pm' ? 'the-pm' : null) })
    );
    expect(pm.user_id).toBe('the-pm');
    expect(seen).toEqual(['liaison']);
  });

  it('an empty role holder means Mike', async () => {
    const r = await resolveOwner({ project_id: 'p1', action_payload: { owner_role: 'wordpress' } }, lookups());
    expect(r).toMatchObject({ user_id: MIKE_USER_ID, source: 'mike', role_key: 'wordpress' });
  });

  it('empty everything is Mike', async () => {
    expect(await resolveOwner({}, lookups())).toMatchObject({ user_id: MIKE_USER_ID, source: 'mike' });
    expect(await resolvesToMike({}, lookups())).toBe(true);
    expect(await resolvesToMike({ owner_user_id: 'nils' }, lookups())).toBe(false);
  });

  it('bast and switch_owner roles', async () => {
    expect(await resolveOwner({ action_payload: { owner_role: 'bast' } }, lookups())).toMatchObject({ user_id: BAST_USER_ID, source: 'bast' });
    expect(
      await resolveOwner({ action_payload: { owner_role: 'switch_owner', switch_owner_user_id: 'angela' } }, lookups())
    ).toMatchObject({ user_id: 'angela', source: 'switch_owner' });
    expect((await resolveOwner({ action_payload: { owner_role: 'switch_owner' } }, lookups())).user_id).toBe(MIKE_USER_ID);
  });
});

describe('roleKeyForFunctionName', () => {
  it('maps the seeded function names', () => {
    expect(roleKeyForFunctionName('Project Manager')).toBe('pm');
    expect(roleKeyForFunctionName('design ii')).toBe('design');
    expect(roleKeyForFunctionName('Customer Success Manager')).toBe('liaison');
    expect(roleKeyForFunctionName('Accounts Receivable')).toBe('billing');
    expect(roleKeyForFunctionName('Astronaut')).toBeNull();
    expect(roleKeyForFunctionName(null)).toBeNull();
  });
});

describe('memoizeLookups', () => {
  it('asks the inner lookup once per key', async () => {
    let n = 0;
    const m = memoizeLookups({ ...lookups(), isActiveUser: async () => (n++, true) });
    await m.isActiveUser('a');
    await m.isActiveUser('a');
    await m.isActiveUser('b');
    expect(n).toBe(2);
  });
});
