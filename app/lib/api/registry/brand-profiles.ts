import type { ApiEndpoint } from './index';

const brandProfileResponse = {
  id: 'uuid',
  client_id: 'uuid|null',
  site_id: 'uuid|null',
  voice_profile: 'object|null',
  figma_url: 'string|null',
  component_library_ref: 'string|null',
  brand_tokens: 'object|null',
  notes: 'string|null',
  created_at: 'ISO-8601',
  updated_at: 'ISO-8601',
};

const brandProfileBody = [
  { name: 'voice_profile', type: 'object' as const, required: false, description: 'Voice-test profile (freeform JSON; prose-as-string in v1)' },
  { name: 'figma_url', type: 'string' as const, required: false, description: 'Design-language link' },
  { name: 'component_library_ref', type: 'string' as const, required: false, description: 'Which client component library' },
  { name: 'brand_tokens', type: 'object' as const, required: false, description: 'Freeform JSON: { colors: [...], fonts: [...] }' },
  { name: 'notes', type: 'string' as const, required: false, description: 'Brand notes' },
];

export const brandProfileEndpoints: ApiEndpoint[] = [
  {
    path: '/api/clients/{id}/brand-profile',
    group: 'brand-profiles',
    methods: [
      {
        method: 'GET',
        summary: "A client's brand profile (voice + branding). profile is null until one is set.",
        auth: 'required',
        responseExample: { profile: brandProfileResponse },
      },
      {
        method: 'PUT',
        summary: "Upsert a client's brand profile (create or partial update). Omitted fields are left untouched; null on a JSON field clears it.",
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: brandProfileBody,
        responseExample: { profile: brandProfileResponse },
      },
    ],
  },
  {
    path: '/api/sites/{id}/brand-profile',
    group: 'brand-profiles',
    methods: [
      {
        method: 'GET',
        summary: "A site's own brand profile, the inherited client profile, and the per-field resolved profile the voice/design gates read.",
        auth: 'required',
        responseExample: {
          profile: brandProfileResponse,
          inherited: brandProfileResponse,
          resolved: {
            voice_profile: { value: 'object|null', source: 'site|client|null' },
            figma_url: { value: 'string|null', source: 'site|client|null' },
            component_library_ref: { value: 'string|null', source: 'site|client|null' },
            brand_tokens: { value: 'object|null', source: 'site|client|null' },
            notes: { value: 'string|null', source: 'site|client|null' },
          },
        },
        responseNotes:
          'resolved is the effective profile for the site: each field is the site\'s own value where set, else the client\'s (per-field cascade), with source telling which.',
      },
      {
        method: 'PUT',
        summary: "Upsert a site's own brand profile (overrides the cascade per-field). Returns the refreshed { profile, inherited, resolved }.",
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: brandProfileBody,
        responseExample: { profile: brandProfileResponse, inherited: brandProfileResponse, resolved: {} },
      },
    ],
  },
];
