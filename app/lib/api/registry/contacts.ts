import type { ApiEndpoint } from './index';

const contactResponse = {
  id: 'uuid',
  client_id: 'uuid',
  name: 'string|null',
  email: 'string',
  role: 'string|null',
  can_initiate_work: 'boolean',
  is_primary: 'boolean',
  notes: 'string|null',
  created_at: 'ISO-8601',
  updated_at: 'ISO-8601',
};

export const contactEndpoints: ApiEndpoint[] = [
  {
    path: '/api/contacts/resolve',
    group: 'contacts',
    methods: [
      {
        method: 'GET',
        summary:
          'Resolve a sender email to the client(s) it is an authorized contact for, with each client\'s sites (name, url, site_type, domains, notes) so a caller can determine which site an email is about and whether the sender may initiate work. Case-insensitive on the trimmed email.',
        auth: 'required',
        queryParams: [
          { name: 'email', type: 'string', required: true, description: 'Sender email to resolve' },
        ],
        responseExample: {
          email: 'string',
          matches: [
            {
              contact_id: 'uuid',
              name: 'string|null',
              role: 'string|null',
              can_initiate_work: 'boolean',
              is_primary: 'boolean',
              client: {
                id: 'uuid',
                name: 'string',
                type: 'direct|agency_partner|sub_client',
                status: 'active|inactive|delinquent',
              },
              sites: [
                {
                  id: 'uuid',
                  name: 'string',
                  url: 'string|null',
                  site_type: 'eleventy|wordpress|handoff|null',
                  domains: 'string[]',
                  notes: 'string|null',
                },
              ],
            },
          ],
        },
        responseNotes:
          'matches is empty when the email is unknown. Site disambiguation is the caller\'s job: match the email content (not the sender domain) against each site\'s name/notes/url/domains.',
      },
    ],
  },
  {
    path: '/api/clients/{id}/contacts',
    group: 'contacts',
    methods: [
      {
        method: 'GET',
        summary: 'List a client\'s authorized contacts.',
        auth: 'required',
        responseExample: { contacts: [contactResponse] },
      },
      {
        method: 'POST',
        summary: 'Add a contact to a client. Unique per (client, email); re-adding a soft-deleted email revives it.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: false, description: 'Contact name' },
          { name: 'email', type: 'string', required: true, description: 'Contact email' },
          { name: 'role', type: 'string', required: false, description: 'Role/title' },
          { name: 'can_initiate_work', type: 'boolean', required: false, description: 'May this contact trigger work (default false)' },
          { name: 'is_primary', type: 'boolean', required: false, description: 'Primary contact flag (default false)' },
          { name: 'notes', type: 'string', required: false, description: 'Notes' },
        ],
        responseExample: contactResponse,
      },
    ],
  },
  {
    path: '/api/contacts/{id}',
    group: 'contacts',
    methods: [
      {
        method: 'PATCH',
        summary: 'Update a contact.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: false, description: 'Contact name' },
          { name: 'email', type: 'string', required: false, description: 'Contact email' },
          { name: 'role', type: 'string', required: false, description: 'Role/title' },
          { name: 'can_initiate_work', type: 'boolean', required: false, description: 'May this contact trigger work' },
          { name: 'is_primary', type: 'boolean', required: false, description: 'Primary contact flag' },
          { name: 'notes', type: 'string', required: false, description: 'Notes' },
        ],
        responseExample: contactResponse,
      },
      {
        method: 'DELETE',
        summary: 'Soft delete a contact.',
        auth: 'required',
        roles: ['pm', 'admin'],
        responseExample: { success: true },
      },
    ],
  },
];
