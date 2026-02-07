/**
 * API Route Registry
 *
 * Structured definitions of all API endpoints. Consumed by GET /api/docs
 * to provide self-documenting API discovery for LLM agents and external tools.
 *
 * IMPORTANT: Update the relevant domain file whenever you add, modify, or remove an API endpoint.
 *
 * Domain files are in this directory — one per domain group.
 */

export interface ParamDef {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'uuid' | 'ISO-8601' | 'string[]' | 'object' | 'file';
  required: boolean;
  description: string;
}

export interface MethodDef {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  summary: string;
  auth: 'required' | 'none' | 'cron';
  roles?: string[];
  queryParams?: ParamDef[];
  bodySchema?: ParamDef[];
  responseExample?: object;
  responseNotes?: string;
}

export interface ApiEndpoint {
  path: string;
  group?: string;
  methods: MethodDef[];
}

import { authEndpoints } from './auth';
import { dashboardEndpoints } from './dashboard';
import { clientEndpoints } from './clients';
import { projectEndpoints } from './projects';
import { taskEndpoints } from './tasks';
import { timeEntryEndpoints } from './time-entries';
import { siteEndpoints } from './sites';
import { sopEndpoints } from './sops';
import { userEndpoints } from './users';
import { billingEndpoints } from './billing';
import { referenceEndpoints } from './reference';
import { adminEndpoints } from './admin';
import { miscEndpoints } from './misc';

export const apiRegistry: ApiEndpoint[] = [
  ...authEndpoints,
  ...dashboardEndpoints,
  ...clientEndpoints,
  ...projectEndpoints,
  ...taskEndpoints,
  ...timeEntryEndpoints,
  ...siteEndpoints,
  ...sopEndpoints,
  ...userEndpoints,
  ...billingEndpoints,
  ...referenceEndpoints,
  ...adminEndpoints,
  ...miscEndpoints,
];

/**
 * Common enums used across the API
 */
export const apiEnums = {
  userRoles: ['tech', 'pm', 'admin'],
  projectStatuses: ['quote', 'queue', 'ready', 'in_progress', 'review', 'done', 'suspended', 'cancelled'],
  projectTypes: ['project', 'retainer', 'internal'],
  taskStatuses: ['not_started', 'in_progress', 'review', 'done', 'blocked', 'abandoned'],
  taskPriorities: [1, 2, 3, 4, 5],
  mysteryFactors: ['none', 'average', 'significant', 'no_idea'],
  batteryImpacts: ['average_drain', 'high_drain', 'energizing'],
  billingTypes: ['fixed', 'hourly', 'retainer', 'none'],
  clientStatuses: ['active', 'inactive', 'delinquent'],
  clientTypes: ['direct', 'agency_partner', 'sub_client'],
};

/**
 * General info about the API for LLM consumers
 */
export const apiInfo = {
  auth: {
    method: 'Bearer token in Authorization header',
    header: 'Authorization: Bearer citadel_<your-api-key>',
    note: 'API keys can be created via POST /api/api-keys or the settings UI.',
  },
  pagination: {
    queryParams: { page: 'Page number (1-based)', limit: 'Items per page (default varies, usually 50)' },
    responseShape: { data: '[]', pagination: { page: 'number', limit: 'number', total: 'number', totalPages: 'number' } },
  },
  softDeletes: 'Most entities use soft delete (is_deleted flag). DELETE requests set is_deleted=true rather than removing records.',
  ids: 'All IDs are UUIDs.',
};
