import type { ApiEndpoint } from './index';

export const onboardingEndpoints: ApiEndpoint[] = [
  {
    path: '/api/portal/onboard/:token',
    group: 'onboarding',
    methods: [
      {
        method: 'GET',
        summary: 'View onboarding form data via portal token. Returns lead info pre-filled. Public, no auth required.',
        auth: 'none',
        responseExample: {
          accord_name: 'string',
          lead_name: 'string|null',
          lead_business_name: 'string|null',
          lead_email: 'string|null',
          lead_phone: 'string|null',
        },
        responseNotes: 'Returns 404 if token is invalid or expired.',
      },
      {
        method: 'POST',
        summary: 'Submit onboarding info. Creates a Client record from lead information and links to the accord. Public, no auth required.',
        auth: 'none',
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Client/business name' },
          { name: 'primary_contact', type: 'string', required: false, description: 'Primary contact person name' },
          { name: 'email', type: 'string', required: false, description: 'Client email' },
          { name: 'phone', type: 'string', required: false, description: 'Client phone' },
        ],
        responseExample: {
          message: 'Onboarding complete',
          client_id: 'uuid',
        },
      },
    ],
  },
];
