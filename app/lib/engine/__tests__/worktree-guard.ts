/**
 * One scratch database per worktree (see seed.ts). A worktree directory is named `citadel-<slug>-wt`
 * (the slug may carry hyphens); the scratch database must carry that slug as a whole underscore-separated
 * word, so `citadel_c4_scratch` belongs to `c4` and `citadel_c45_scratch` does not.
 */
export function worktreeSlug(cwd: string): string | null {
  for (const part of cwd.split('/')) {
    const m = /^citadel-(.+)-wt$/.exec(part);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

export function dbNameOf(databaseUrl: string): string {
  return /\/([^/?]+)(?:\?|$)/.exec(databaseUrl)?.[1] ?? '';
}

export function dbBelongsToWorktree(dbName: string, slug: string): boolean {
  const words = `_${dbName.toLowerCase().replace(/[^a-z0-9]+/g, '_')}_`;
  return words.includes(`_${slug.replace(/[^a-z0-9]+/g, '_')}_`);
}
