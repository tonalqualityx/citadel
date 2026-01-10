// Query key factory pattern for consistent cache management

export interface ClientFilters {
  search?: string;
  status?: 'active' | 'inactive' | 'delinquent';
  type?: 'direct' | 'agency_partner' | 'sub_client';
  page?: number;
  limit?: number;
}

export interface SiteFilters {
  search?: string;
  client_id?: string;
  page?: number;
  limit?: number;
}

export interface DomainFilters {
  search?: string;
  siteId?: string;
  page?: number;
  limit?: number;
}

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters: ClientFilters) => [...clientKeys.lists(), filters] as const,
  details: () => [...clientKeys.all, 'detail'] as const,
  detail: (id: string) => [...clientKeys.details(), id] as const,
};

export const siteKeys = {
  all: ['sites'] as const,
  lists: () => [...siteKeys.all, 'list'] as const,
  list: (filters: SiteFilters) => [...siteKeys.lists(), filters] as const,
  details: () => [...siteKeys.all, 'detail'] as const,
  detail: (id: string) => [...siteKeys.details(), id] as const,
  byClient: (clientId: string) => [...siteKeys.all, 'byClient', clientId] as const,
};

export const domainKeys = {
  all: ['domains'] as const,
  lists: () => [...domainKeys.all, 'list'] as const,
  list: (filters: DomainFilters) => [...domainKeys.lists(), filters] as const,
  details: () => [...domainKeys.all, 'detail'] as const,
  detail: (id: string) => [...domainKeys.details(), id] as const,
  bySite: (siteId: string) => [...domainKeys.all, 'bySite', siteId] as const,
};

export const referenceDataKeys = {
  hostingPlans: ['hosting-plans'] as const,
  maintenancePlans: ['maintenance-plans'] as const,
  functions: ['functions'] as const,
  tools: ['tools'] as const,
  users: ['users'] as const,
};

// User function keys (tracks which functions a user is qualified for)
export const userFunctionKeys = {
  all: ['user-functions'] as const,
  byUser: (userId: string) => [...userFunctionKeys.all, 'user', userId] as const,
};

// Project filters and keys
export interface ProjectFilters {
  search?: string;
  status?: 'quote' | 'queue' | 'ready' | 'in_progress' | 'review' | 'done' | 'suspended' | 'cancelled';
  type?: 'project' | 'retainer' | 'internal';
  client_id?: string;
  site_id?: string;
  page?: number;
  limit?: number;
}

export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters: ProjectFilters) => [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
  byClient: (clientId: string) => [...projectKeys.all, 'byClient', clientId] as const,
  bySite: (siteId: string) => [...projectKeys.all, 'bySite', siteId] as const,
  team: (id: string) => [...projectKeys.all, 'team', id] as const,
};

// Task filters and keys
export interface TaskFilters {
  search?: string;
  status?: string; // Single status (legacy)
  statuses?: string[]; // Multiple statuses - comma-separated when sent to API
  priority?: number;
  project_id?: string;
  assignee_id?: string;
  phase?: string;
  my_tasks?: boolean;
  pending_review?: boolean; // Filter for tasks awaiting review (done + needs_review + !approved)
  page?: number;
  limit?: number;
}

export const taskKeys = {
  all: ['tasks'] as const,
  lists: () => [...taskKeys.all, 'list'] as const,
  list: (filters: TaskFilters) => [...taskKeys.lists(), filters] as const,
  details: () => [...taskKeys.all, 'detail'] as const,
  detail: (id: string) => [...taskKeys.details(), id] as const,
  byProject: (projectId: string) => [...taskKeys.all, 'byProject', projectId] as const,
  byAssignee: (assigneeId: string) => [...taskKeys.all, 'byAssignee', assigneeId] as const,
};

// Billing keys
export const billingKeys = {
  all: ['billing'] as const,
  unbilled: () => [...billingKeys.all, 'unbilled'] as const,
};

// Integration keys
export const integrationKeys = {
  all: ['integrations'] as const,
  lists: () => [...integrationKeys.all, 'list'] as const,
  provider: (provider: string) => [...integrationKeys.all, 'provider', provider] as const,
};

// DNS Provider keys
export const dnsProviderKeys = {
  all: ['dns-providers'] as const,
  list: () => [...dnsProviderKeys.all, 'list'] as const,
};

// Client Activity keys
export const clientActivityKeys = {
  all: ['client-activity'] as const,
  byClient: (clientId: string, filters?: { projectStatus?: string; taskType?: string; taskStatus?: string }) =>
    [...clientActivityKeys.all, clientId, filters] as const,
};

// App Settings keys
export const appSettingsKeys = {
  all: ['app-settings'] as const,
  bugReport: () => [...appSettingsKeys.all, 'bug-report'] as const,
};

// Consolidated query keys for convenience
export const queryKeys = {
  clients: clientKeys,
  sites: siteKeys,
  domains: domainKeys,
  projects: projectKeys,
  tasks: taskKeys,
  billing: billingKeys,
  integrations: integrationKeys,
  referenceData: referenceDataKeys,
  dnsProviders: dnsProviderKeys,
  clientActivity: clientActivityKeys,
  appSettings: appSettingsKeys,
};
