// Client types
export type ClientType = 'direct' | 'agency_partner' | 'sub_client';
export type ClientStatus = 'active' | 'inactive' | 'delinquent';
export type HostedBy = 'indelible' | 'client' | 'other';

export interface Client {
  id: string;
  name: string;
  type: ClientType;
  status: ClientStatus;
  primary_contact: string | null;
  email: string | null;
  phone: string | null;
  retainer_hours: number | null;
  hourly_rate: number | null;
  parent_agency_id: string | null;
  notes: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClientWithRelations extends Client {
  sites?: Site[];
  sub_clients?: Client[];
  parent_agency?: { id: string; name: string } | null;
  sites_count?: number;
  sub_clients_count?: number;
}

export interface CreateClientInput {
  name: string;
  type?: ClientType;
  status?: ClientStatus;
  primary_contact?: string;
  email?: string;
  phone?: string;
  retainer_hours?: number;
  hourly_rate?: number;
  parent_agency_id?: string;
  notes?: string;
}

export interface UpdateClientInput extends Partial<CreateClientInput> {}

export interface ClientListResponse {
  clients: ClientWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Site types
export interface Site {
  id: string;
  name: string;
  url: string | null;
  client_id: string;
  hosted_by: HostedBy;
  platform: string | null;
  hosting_plan_id: string | null;
  maintenance_plan_id: string | null;
  notes: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface SiteWithRelations extends Site {
  client?: { id: string; name: string };
  hosting_plan?: { id: string; name: string; rate: number } | null;
  maintenance_plan?: { id: string; name: string; rate: number } | null;
  domains?: Domain[];
  domains_count?: number;
}

export interface CreateSiteInput {
  name: string;
  url?: string;
  client_id: string;
  hosted_by?: HostedBy;
  platform?: string;
  hosting_plan_id?: string;
  maintenance_plan_id?: string;
  notes?: string;
}

export interface UpdateSiteInput extends Partial<Omit<CreateSiteInput, 'client_id'>> {}

export interface SiteListResponse {
  sites: SiteWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Domain types
export interface Domain {
  id: string;
  name: string;
  site_id: string;
  registrar: string | null;
  expires_at: string | null;
  is_primary: boolean;
  notes: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface DomainWithRelations extends Domain {
  site?: { id: string; name: string; client?: { id: string; name: string } };
}

export interface CreateDomainInput {
  name: string;
  site_id: string;
  registrar?: string;
  expires_at?: string;
  is_primary?: boolean;
  notes?: string;
}

export interface UpdateDomainInput extends Partial<Omit<CreateDomainInput, 'site_id'>> {}

export interface DomainListResponse {
  domains: DomainWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Reference data types
export interface HostingPlan {
  id: string;
  name: string;
  rate: number;
  agency_rate: number | null;
  monthly_cost: number | null;
  vendor_plan: string | null;
  details: string | null;
  is_active: boolean;
  sites_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateHostingPlanInput {
  name: string;
  rate: number;
  agency_rate?: number | null;
  monthly_cost?: number | null;
  vendor_plan?: string | null;
  details?: string | null;
  is_active?: boolean;
}

export interface UpdateHostingPlanInput extends Partial<CreateHostingPlanInput> {}

export interface HostingPlanListResponse {
  hosting_plans: HostingPlan[];
}

export interface MaintenancePlan {
  id: string;
  name: string;
  rate: number;
  agency_rate: number | null;
  hours: number | null;
  details: string | null;
  is_active: boolean;
  sites_count?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CreateMaintenancePlanInput {
  name: string;
  rate: number;
  agency_rate?: number | null;
  hours?: number | null;
  details?: string | null;
  is_active?: boolean;
}

export interface UpdateMaintenancePlanInput extends Partial<CreateMaintenancePlanInput> {}

export interface MaintenancePlanListResponse {
  maintenance_plans: MaintenancePlan[];
}

export interface TeamFunction {
  id: string;
  name: string;
  primary_focus: string | null;
  sort_order: number;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateFunctionInput {
  name: string;
  primary_focus?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateFunctionInput extends Partial<CreateFunctionInput> {}

export interface FunctionListResponse {
  functions: TeamFunction[];
}

export interface Tool {
  id: string;
  name: string;
  category: string | null;
  url: string | null;
  description: string | null;
  license_key: string | null;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface CreateToolInput {
  name: string;
  category?: string | null;
  url?: string | null;
  description?: string | null;
  is_active?: boolean;
}

export interface UpdateToolInput extends Partial<CreateToolInput> {}

export interface ToolListResponse {
  tools: Tool[];
  categories: string[];
}
