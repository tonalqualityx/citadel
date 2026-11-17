/**
 * What a board reference is for: the designer's own design files (Figma frames, uploads) or inspiration sites.
 * When the track has a usable design file, inspiration is not given to the chat worker or the builds.
 */
export const DESIGN_FILE_SOURCES = ['designer_upload', 'designer_figma'] as const;
export const INSPIRATION_SOURCES = ['bast_pick', 'client_named', 'indelible_site', 'designer_url'] as const;
export type ReferenceRole = 'design_file' | 'inspiration';

export const referenceRole = (source: string): ReferenceRole => ((DESIGN_FILE_SOURCES as readonly string[]).includes(source) ? 'design_file' : 'inspiration');

type PictureView = { url: string | null };
export interface RoleFacts {
  source: string;
  decision: string;
  capture_status: string;
  /** The designer view's uploads: an upload counts when its own picture, or one of its renders, can be served. */
  uploads?: Array<{ asset: PictureView; renders?: PictureView[] }>;
}

/** Not set aside, and a Figma frame that was captured or an upload with at least one ready picture. */
export function isUsableDesignFile(ref: RoleFacts): boolean {
  if (ref.decision === 'no') return false;
  if (ref.source === 'designer_figma') return ref.capture_status === 'captured';
  if (ref.source === 'designer_upload') return (ref.uploads ?? []).some((u) => u.asset.url !== null || (u.renders ?? []).some((r) => r.url !== null));
  return false;
}

export const hasDesignFile = (refs: RoleFacts[]): boolean => refs.some(isUsableDesignFile);
