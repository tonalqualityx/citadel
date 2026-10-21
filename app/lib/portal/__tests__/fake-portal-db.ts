/**
 * Tiny in-memory stand-in for the Prisma calls the portal access code makes (clients, contacts,
 * project grants), with a where-evaluator for the subset those queries use. Lets tests exercise
 * the REAL filters (email match, deleted flags, agency parent, grants) instead of asserting on
 * mock call shapes. Not a general Prisma fake: unknown where keys throw so drift is loud.
 */
import type { Mock } from 'vitest';

type Row = Record<string, unknown>;
interface FClient { id: string; name: string; type: string; parent_agency_id: string | null; is_deleted: boolean }
interface FContact { id: string; client_id: string; email: string; portal_role: string; is_deleted: boolean }
interface FProject { id: string; client_id: string; status: string; portal_visibility: string; is_deleted: boolean }
interface FGrant { project_id: string; contact_id: string; role: string }

export class FakePortalDb {
  clients: FClient[] = [];
  contacts: FContact[] = [];
  projects: FProject[] = [];
  grants: FGrant[] = [];

  reset() {
    this.clients = [];
    this.contacts = [];
    this.projects = [];
    this.grants = [];
  }
  addClient(c: Partial<FClient> & { id: string; name: string }) {
    this.clients.push({ type: 'direct', parent_agency_id: null, is_deleted: false, ...c });
  }
  addContact(c: Partial<FContact> & { id: string; client_id: string; email: string }) {
    this.contacts.push({ portal_role: 'viewer', is_deleted: false, ...c });
  }
  addProject(p: Partial<FProject> & { id: string; client_id: string }) {
    this.projects.push({ status: 'in_progress', portal_visibility: 'inherit', is_deleted: false, ...p });
  }
  addGrant(g: FGrant) {
    this.grants.push(g);
  }

  private client(id: string) {
    return this.clients.find((c) => c.id === id);
  }

  /** Match one value against a Prisma scalar filter. */
  private scalar(value: unknown, filter: unknown): boolean {
    if (filter === null || typeof filter !== 'object' || filter instanceof Date) return value === filter;
    const f = filter as Row;
    for (const [op, arg] of Object.entries(f)) {
      if (op === 'equals') {
        if (f.mode === 'insensitive') {
          if (String(value).toLowerCase() !== String(arg).toLowerCase()) return false;
        } else if (value !== arg) return false;
      } else if (op === 'mode') continue;
      else if (op === 'in') { if (!(arg as unknown[]).includes(value)) return false; }
      else if (op === 'notIn') { if ((arg as unknown[]).includes(value)) return false; }
      else if (op === 'not') { if (value === arg) return false; }
      else throw new Error(`fake db: unsupported scalar op ${op}`);
    }
    return true;
  }

  private matchProject(p: FProject, where: Row): boolean {
    for (const [key, val] of Object.entries(where)) {
      if (key === 'AND') { if (!(val as Row[]).every((w) => this.matchProject(p, w))) return false; }
      else if (key === 'OR') { if (!(val as Row[]).some((w) => this.matchProject(p, w))) return false; }
      else if (key === 'contact_grants') {
        const some = (val as { some: Row }).some;
        const ok = this.grants.some(
          (g) => g.project_id === p.id && Object.entries(some).every(([k, v]) => this.scalar((g as unknown as Row)[k], v))
        );
        if (!ok) return false;
      } else if (key === 'client') {
        const cl = this.client(p.client_id)!;
        if (!Object.entries(val as Row).every(([k, v]) => this.scalar((cl as unknown as Row)[k], v))) return false;
      } else if (['id', 'client_id', 'status', 'portal_visibility', 'is_deleted'].includes(key)) {
        if (!this.scalar((p as unknown as Row)[key], val)) return false;
      } else throw new Error(`fake db: unsupported project key ${key}`);
    }
    return true;
  }

  /** Ids of projects matching a projectAccessWhere()-style filter. */
  visibleProjectIds(where: object): string[] {
    return this.projects.filter((p) => this.matchProject(p, where as Row)).map((p) => p.id).sort();
  }

  /** Point the mocked prisma calls at this store. */
  install(prisma: Record<string, Record<string, Mock>>) {
    prisma.clientContact.findMany.mockImplementation(async ({ where }: { where: Row }) => {
      return this.contacts
        .filter((c) => {
          const cl = this.client(c.client_id);
          for (const [k, v] of Object.entries(where)) {
            if (k === 'client') { if (!cl || !Object.entries(v as Row).every(([ck, cv]) => this.scalar((cl as unknown as Row)[ck], cv))) return false; }
            else if (['email', 'is_deleted', 'id', 'client_id'].includes(k)) { if (!this.scalar((c as unknown as Row)[k], v)) return false; }
            else throw new Error(`fake db: unsupported contact key ${k}`);
          }
          return true;
        })
        .map((c) => ({ ...c, client: { id: c.client_id, name: this.client(c.client_id)?.name } }));
    });
    prisma.client.findMany.mockImplementation(async ({ where }: { where: Row }) =>
      this.clients.filter((c) =>
        Object.entries(where).every(([k, v]) => {
          if (!['parent_agency_id', 'is_deleted', 'id'].includes(k)) throw new Error(`fake db: unsupported client key ${k}`);
          return this.scalar((c as unknown as Row)[k], v);
        })
      )
    );
    prisma.projectContact.findMany.mockImplementation(async ({ where }: { where: Row }) => {
      const { project: projectWhere, ...own } = where as { project: Row } & Row;
      return this.grants
        .filter((g) => Object.entries(own).every(([k, v]) => this.scalar((g as unknown as Row)[k], v)))
        .filter((g) => {
          const p = this.projects.find((x) => x.id === g.project_id);
          return !!p && this.matchProject(p, projectWhere);
        })
        .map((g) => {
          const p = this.projects.find((x) => x.id === g.project_id)!;
          const cl = this.client(p.client_id)!;
          return { contact_id: g.contact_id, role: g.role, project: { client_id: p.client_id, client: { id: cl.id, name: cl.name } } };
        });
    });
  }
}

