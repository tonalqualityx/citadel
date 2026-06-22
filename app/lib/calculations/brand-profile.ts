/**
 * Per-field brand-profile cascade.
 *
 * A site's *effective* brand profile = its own value where set, else the owning client's value,
 * resolved field by field. So a site can override just its accent color while still inheriting the
 * client's voice_profile. The voice/design quality gates read this resolved profile for the site
 * being worked. Mike confirmed per-field cascade (not whole-record fallback) on task ed24d77e.
 */

export const BRAND_FIELDS = [
  'voice_profile',
  'figma_url',
  'component_library_ref',
  'brand_tokens',
  'notes',
] as const;

export type BrandField = (typeof BRAND_FIELDS)[number];

/** Minimal shape the cascade reads — both API responses and Prisma rows satisfy it. */
export type BrandProfileValues = {
  [K in BrandField]?: unknown;
};

export type BrandSource = 'site' | 'client' | null;

export interface ResolvedField {
  value: unknown;
  source: BrandSource;
}

export type ResolvedBrandProfile = Record<BrandField, ResolvedField>;

/** A field counts as "set" when it is neither null nor undefined (empty string clears to null upstream). */
function isSet(value: unknown): boolean {
  return value !== null && value !== undefined;
}

/**
 * Resolve a site's effective brand profile from its own profile and the client's, per field.
 * Either argument may be null/undefined (no profile yet). Returns every field with its value and
 * the source it came from ('site' | 'client' | null when neither has it).
 */
export function resolveBrandProfile(
  site: BrandProfileValues | null | undefined,
  client: BrandProfileValues | null | undefined
): ResolvedBrandProfile {
  const resolved = {} as ResolvedBrandProfile;

  for (const field of BRAND_FIELDS) {
    const siteValue = site ? site[field] : undefined;
    const clientValue = client ? client[field] : undefined;

    if (isSet(siteValue)) {
      resolved[field] = { value: siteValue, source: 'site' };
    } else if (isSet(clientValue)) {
      resolved[field] = { value: clientValue, source: 'client' };
    } else {
      resolved[field] = { value: null, source: null };
    }
  }

  return resolved;
}
