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
  statuses?: string[]; // Multiple statuses - comma-separated when sent to API
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
  active_only?: boolean; // Excludes done and abandoned tasks (ignored if status/statuses provided)
  priority?: number;
  project_id?: string;
  accord_id?: string;
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

// Client Retainer keys
export const clientRetainerKeys = {
  all: ['client-retainer'] as const,
  byClient: (clientId: string, month: string) =>
    [...clientRetainerKeys.all, clientId, month] as const,
};

// Ware keys
export interface WareFilters {
  search?: string;
  type?: 'commission' | 'charter';
  is_active?: boolean;
  page?: number;
  limit?: number;
}

export const wareKeys = {
  all: ['wares'] as const,
  lists: () => [...wareKeys.all, 'list'] as const,
  list: (filters: WareFilters) => [...wareKeys.lists(), filters] as const,
  details: () => [...wareKeys.all, 'detail'] as const,
  detail: (id: string) => [...wareKeys.details(), id] as const,
};

// Accord keys
export interface AccordFilters {
  search?: string;
  status?: string;
  owner_id?: string;
  client_id?: string;
  page?: number;
  limit?: number;
}

export const accordKeys = {
  all: ['accords'] as const,
  lists: () => [...accordKeys.all, 'list'] as const,
  list: (filters: AccordFilters) => [...accordKeys.lists(), filters] as const,
  details: () => [...accordKeys.all, 'detail'] as const,
  detail: (id: string) => [...accordKeys.details(), id] as const,
};

// Proposal keys
export interface ProposalFilters {
  accord_id?: string;
}

export const proposalKeys = {
  all: ['proposals'] as const,
  lists: () => [...proposalKeys.all, 'list'] as const,
  list: (filters: ProposalFilters) => [...proposalKeys.lists(), filters] as const,
  byAccord: (accordId: string) => [...proposalKeys.all, 'byAccord', accordId] as const,
  details: () => [...proposalKeys.all, 'detail'] as const,
  detail: (accordId: string, proposalId: string) => [...proposalKeys.details(), accordId, proposalId] as const,
};

// Contract keys
export interface ContractFilters {
  accord_id?: string;
}

export const contractKeys = {
  all: ['contracts'] as const,
  lists: () => [...contractKeys.all, 'list'] as const,
  list: (filters: ContractFilters) => [...contractKeys.lists(), filters] as const,
  byAccord: (accordId: string) => [...contractKeys.all, 'byAccord', accordId] as const,
  details: () => [...contractKeys.all, 'detail'] as const,
  detail: (accordId: string, contractId: string) => [...contractKeys.details(), accordId, contractId] as const,
};

// MSA keys
export const msaKeys = {
  all: ['msa'] as const,
  lists: () => [...msaKeys.all, 'list'] as const,
  list: () => [...msaKeys.lists()] as const,
  current: () => [...msaKeys.all, 'current'] as const,
  details: () => [...msaKeys.all, 'detail'] as const,
  detail: (id: string) => [...msaKeys.details(), id] as const,
  clientStatus: (clientId: string) => [...msaKeys.all, 'clientStatus', clientId] as const,
};

// Charter keys
export interface CharterFilters {
  search?: string;
  status?: 'active' | 'paused' | 'cancelled';
  client_id?: string;
  page?: number;
  limit?: number;
}

export const charterKeys = {
  all: ['charters'] as const,
  lists: () => [...charterKeys.all, 'list'] as const,
  list: (filters: CharterFilters) => [...charterKeys.lists(), filters] as const,
  details: () => [...charterKeys.all, 'detail'] as const,
  detail: (id: string) => [...charterKeys.details(), id] as const,
  byClient: (clientId: string) => [...charterKeys.all, 'byClient', clientId] as const,
  usage: (id: string, period?: string) => [...charterKeys.all, 'usage', id, period] as const,
};

// Addendum keys
export interface AddendumFilters {
  accord_id?: string;
}

export const addendumKeys = {
  all: ['addendums'] as const,
  lists: () => [...addendumKeys.all, 'list'] as const,
  list: (filters: AddendumFilters) => [...addendumKeys.lists(), filters] as const,
  byAccord: (accordId: string) => [...addendumKeys.all, 'byAccord', accordId] as const,
  details: () => [...addendumKeys.all, 'detail'] as const,
  detail: (accordId: string, addendumId: string) => [...addendumKeys.details(), accordId, addendumId] as const,
};

// Meeting keys
export interface MeetingFilters {
  search?: string;
  client_id?: string;
  accord_id?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

export const meetingKeys = {
  all: ['meetings'] as const,
  lists: () => [...meetingKeys.all, 'list'] as const,
  list: (filters: MeetingFilters) => [...meetingKeys.lists(), filters] as const,
  details: () => [...meetingKeys.all, 'detail'] as const,
  detail: (id: string) => [...meetingKeys.details(), id] as const,
  byClient: (clientId: string) => [...meetingKeys.all, 'byClient', clientId] as const,
  byAccord: (accordId: string) => [...meetingKeys.all, 'byAccord', accordId] as const,
  byProject: (projectId: string) => [...meetingKeys.all, 'byProject', projectId] as const,
  byCharter: (charterId: string) => [...meetingKeys.all, 'byCharter', charterId] as const,
  incomplete: () => [...meetingKeys.all, 'incomplete'] as const,
};

// Automation rule keys
export const automationRuleKeys = {
  all: ['automation-rules'] as const,
  lists: () => [...automationRuleKeys.all, 'list'] as const,
  list: () => [...automationRuleKeys.lists()] as const,
  details: () => [...automationRuleKeys.all, 'detail'] as const,
  detail: (id: string) => [...automationRuleKeys.details(), id] as const,
};

// API Key keys
export const apiKeyKeys = {
  all: ['api-keys'] as const,
  lists: () => [...apiKeyKeys.all, 'list'] as const,
};

// App Settings keys
export const appSettingsKeys = {
  all: ['app-settings'] as const,
  bugReport: () => [...appSettingsKeys.all, 'bug-report'] as const,
};

// Accord Charter Item keys
export const accordCharterItemKeys = {
  all: ['accord-charter-items'] as const,
  byAccord: (accordId: string) => [...accordCharterItemKeys.all, accordId] as const,
};

// Accord Commission Item keys
export const accordCommissionItemKeys = {
  all: ['accord-commission-items'] as const,
  byAccord: (accordId: string) => [...accordCommissionItemKeys.all, accordId] as const,
};

// Accord Keep Item keys
export const accordKeepItemKeys = {
  all: ['accord-keep-items'] as const,
  byAccord: (accordId: string) => [...accordKeepItemKeys.all, accordId] as const,
};

// Consolidated query keys for convenience
export const queryKeys = {
  clients: clientKeys,
  sites: siteKeys,
  domains: domainKeys,
  projects: projectKeys,
  tasks: taskKeys,
  billing: billingKeys,
  apiKeys: apiKeyKeys,
  integrations: integrationKeys,
  referenceData: referenceDataKeys,
  dnsProviders: dnsProviderKeys,
  clientActivity: clientActivityKeys,
  clientRetainer: clientRetainerKeys,
  appSettings: appSettingsKeys,
  wares: wareKeys,
  accords: accordKeys,
  proposals: proposalKeys,
  contracts: contractKeys,
  msa: msaKeys,
  charters: charterKeys,
  addendums: addendumKeys,
  meetings: meetingKeys,
  automationRules: automationRuleKeys,
  accordCharterItems: accordCharterItemKeys,
  accordCommissionItems: accordCommissionItemKeys,
  accordKeepItems: accordKeepItemKeys,
};
