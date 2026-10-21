import { describe, it, expect } from 'vitest';
import { dbBelongsToWorktree, dbNameOf, worktreeSlug } from './worktree-guard';

describe('worktree scratch database guard', () => {
  it('reads the slug from the full worktree name', () => {
    expect(worktreeSlug('/home/mike/.openclaw/workspace/citadel-c4-wt/app')).toBe('c4');
    expect(worktreeSlug('/x/citadel-portal-c4-wt/app')).toBe('portal-c4');
    expect(worktreeSlug('/x/citadel/app')).toBeNull();
    expect(worktreeSlug('/x/citadel-wt/app')).toBeNull();
  });
  it('matches the database on a word boundary: c4 is not c45', () => {
    expect(dbBelongsToWorktree('citadel_c4_scratch', 'c4')).toBe(true);
    expect(dbBelongsToWorktree('citadel_c45_scratch', 'c4')).toBe(false);
    expect(dbBelongsToWorktree('citadel_xc4_scratch', 'c4')).toBe(false);
    expect(dbBelongsToWorktree('citadel_c4_scratch', 'c45')).toBe(false);
    expect(dbBelongsToWorktree('citadel_c2_scratch', 'c4')).toBe(false);
  });
  it('hyphenated worktree names match underscored database names', () => {
    expect(dbBelongsToWorktree('citadel_portal_c4_scratch', 'portal-c4')).toBe(true);
    expect(dbBelongsToWorktree('citadel_portal_c45_scratch', 'portal-c4')).toBe(false);
    expect(dbBelongsToWorktree('citadel_c4_scratch', 'portal-c4')).toBe(false);
  });
  it('reads the database name from a url', () => {
    expect(dbNameOf('postgresql://citadel:citadel@localhost:5499/citadel_c4_scratch')).toBe('citadel_c4_scratch');
    expect(dbNameOf('postgresql://u:p@h:5/citadel_c4_scratch?schema=public')).toBe('citadel_c4_scratch');
  });
});
