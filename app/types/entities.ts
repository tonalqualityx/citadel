// Client types
export type ClientType = 'direct' | 'agency_partner' | 'sub_client';
export type ClientStatus = 'active' | 'inactive' | 'delinquent';
export type RetainerUsageMode = 'low' | 'medium' | 'high' | 'actual';
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
  retainer_usage_mode: RetainerUsageMode;
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

export interface UpdateClientInput {
  name?: string;
  type?: ClientType;
  status?: ClientStatus;
  primary_contact?: string | null;
  email?: string | null;
  phone?: string | null;
  retainer_hours?: number;
  hourly_rate?: number;
  retainer_usage_mode?: RetainerUsageMode;
  parent_agency_id?: string;
  notes?: string | null;
}

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
  hosting_discount: number | null;  // Fixed $ discount off hosting plan rate
  maintenance_plan_id: string | null;
  maintenance_assignee_id: string | null;
  notes: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface SiteWithRelations extends Site {
  client?: { id: string; name: string };
  hosting_plan?: { id: string; name: string; rate: number } | null;
  maintenance_plan?: { id: string; name: string; rate: number; frequency?: string } | null;
  maintenance_assignee?: { id: string; name: string; email: string } | null;
  domains?: Domain[];
  domains_count?: number;
  primary_domain?: Domain | null;  // The domain marked is_primary
}

export interface CreateSiteInput {
  name: string;
  client_id: string;
  hosted_by?: HostedBy;
  platform?: string;
  hosting_plan_id?: string;
  hosting_discount?: number;
  maintenance_plan_id?: string;
  maintenance_assignee_id?: string | null;
  notes?: string;
}

export interface UpdateSiteInput {
  name?: string;
  client_id?: string | null;
  hosted_by?: HostedBy;
  platform?: string | null;
  hosting_plan_id?: string | null;
  hosting_discount?: number | null;
  maintenance_plan_id?: string | null;
  maintenance_assignee_id?: string | null;
  notes?: string | null;
}

export interface SiteListResponse {
  sites: SiteWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Domain types
export type DomainOwnership = 'indelible' | 'client';

export interface Domain {
  id: string;
  name: string;
  site_id: string | null; // Nullable - domain can exist without being linked to a site
  registrar: string | null;
  expires_at: string | null;
  is_primary: boolean;
  // Ownership & DNS
  registered_by: DomainOwnership | null;
  dns_provider_id: string | null;
  dns_managed_by: DomainOwnership | null;
  notes: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface DomainWithRelations extends Domain {
  site?: { id: string; name: string; client?: { id: string; name: string } };
  dns_provider?: { id: string; name: string } | null;
}

export interface CreateDomainInput {
  name: string;
  site_id?: string | null; // Optional - domain can exist without a site
  registrar?: string;
  expires_at?: string;
  is_primary?: boolean;
  registered_by?: DomainOwnership | null;
  dns_provider_id?: string | null;
  dns_managed_by?: DomainOwnership | null;
  notes?: string;
}

export interface UpdateDomainInput {
  name?: string;
  site_id?: string | null; // Can link/unlink from sites
  registrar?: string | null;
  expires_at?: string | null;
  is_primary?: boolean;
  registered_by?: DomainOwnership | null;
  dns_provider_id?: string | null;
  dns_managed_by?: DomainOwnership | null;
  notes?: string | null;
}

export interface DomainListResponse {
  domains: DomainWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Ware types
export type WareType = 'commission' | 'charter';
export type CharterBillingPeriod = 'monthly' | 'annually';

export interface Ware {
  id: string;
  name: string;
  description: string | null;
  type: WareType;
  charter_billing_period: CharterBillingPeriod | null;
  base_price: number | null;
  price_tiers: any | null;
  contract_language: string | null;
  default_schedule: any | null;
  recipe_id: string | null;
  sort_order: number;
  is_active: boolean;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface WareWithRelations extends Ware {
  recipe?: { id: string; name: string } | null;
  line_items_count?: number;
}

export interface CreateWareInput {
  name: string;
  type: WareType;
  description?: string;
  charter_billing_period?: CharterBillingPeriod;
  base_price?: number;
  price_tiers?: any;
  contract_language?: string;
  default_schedule?: any;
  recipe_id?: string;
  sort_order?: number;
  is_active?: boolean;
}

export interface UpdateWareInput {
  name?: string;
  type?: WareType;
  description?: string | null;
  charter_billing_period?: CharterBillingPeriod | null;
  base_price?: number | null;
  price_tiers?: any | null;
  contract_language?: string | null;
  default_schedule?: any | null;
  recipe_id?: string | null;
  sort_order?: number;
  is_active?: boolean;
}

export interface WareListResponse {
  wares: WareWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Accord types
export type AccordStatus = 'lead' | 'meeting' | 'proposal' | 'contract' | 'signed' | 'active' | 'lost';

export interface Accord {
  id: string;
  name: string;
  status: AccordStatus;
  client_id: string | null;
  owner_id: string;
  lead_name: string | null;
  lead_business_name: string | null;
  lead_email: string | null;
  lead_phone: string | null;
  lead_notes: string | null;
  rejection_reason: string | null;
  payment_confirmed: boolean;
  payment_confirmed_at: string | null;
  total_value: number | null;
  entered_current_status_at: string;
  lost_at: string | null;
  signed_at: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccordCharterItem {
  id: string;
  accord_id: string;
  ware_id: string;
  ware?: { id: string; name: string; type: WareType };
  name_override: string | null;
  price_tier: string | null;
  base_price: number;
  discount_type: 'percent' | 'flat' | null;
  discount_value: number | null;
  final_price: number;
  billing_period: 'monthly' | 'annually';
  duration_months: number;
  total_contract_value: number;
  charter_id: string | null;
  contract_language_override: string | null;
  addendum_id: string | null;
  sort_order: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccordCommissionItem {
  id: string;
  accord_id: string;
  ware_id: string;
  ware?: { id: string; name: string; type: WareType };
  name_override: string | null;
  estimated_price: number | null;
  project_id: string | null;
  project?: { id: string; name: string; budget_amount: number | null } | null;
  discount_type: 'percent' | 'flat' | null;
  discount_value: number | null;
  final_price: number | null;
  contract_language_override: string | null;
  addendum_id: string | null;
  sort_order: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccordKeepItem {
  id: string;
  accord_id: string;
  site_id: string | null;
  site?: { id: string; name: string; url: string | null } | null;
  site_name_placeholder: string | null;
  domain_name: string | null;
  hosting_plan_id: string | null;
  hosting_plan?: { id: string; name: string; rate: number } | null;
  maintenance_plan_id: string | null;
  maintenance_plan?: { id: string; name: string; rate: number } | null;
  hosting_price: number | null;
  hosting_discount_type: 'percent' | 'flat' | null;
  hosting_discount_value: number | null;
  hosting_final_price: number | null;
  maintenance_price: number | null;
  maintenance_discount_type: 'percent' | 'flat' | null;
  maintenance_discount_value: number | null;
  maintenance_final_price: number | null;
  monthly_total: number | null;
  is_client_hosted: boolean;
  contract_language_override: string | null;
  addendum_id: string | null;
  sort_order: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AccordWithRelations extends Accord {
  client?: { id: string; name: string; status: string } | null;
  owner?: { id: string; name: string; email: string; avatar_url: string | null };
  charter_items?: AccordCharterItem[];
  commission_items?: AccordCommissionItem[];
  keep_items?: AccordKeepItem[];
  charter_items_count?: number;
  commission_items_count?: number;
  keep_items_count?: number;
  mrr?: number;
  total_project_value?: number | null;
  total_contract_value?: number | null;
}

export interface CreateAccordInput {
  name: string;
  client_id?: string;
  owner_id?: string;
  lead_name?: string;
  lead_business_name?: string;
  lead_email?: string;
  lead_phone?: string;
  lead_notes?: string;
  status?: AccordStatus;
}

export interface UpdateAccordInput {
  name?: string;
  client_id?: string | null;
  owner_id?: string;
  lead_name?: string | null;
  lead_business_name?: string | null;
  lead_email?: string | null;
  lead_phone?: string | null;
  lead_notes?: string | null;
  rejection_reason?: string | null;
  payment_confirmed?: boolean;
}

export interface AccordListResponse {
  accords: AccordWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// Proposal types
export type ProposalStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'changes_requested';

export interface Proposal {
  id: string;
  accord_id: string;
  version: number;
  content: string;
  status: ProposalStatus;
  pricing_snapshot: any;
  sent_at: string | null;
  client_responded_at: string | null;
  client_note: string | null;
  portal_token: string | null;
  portal_token_expires_at: string | null;
  created_by_id: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ProposalWithRelations extends Proposal {
  accord?: { id: string; name: string; status: AccordStatus };
  created_by?: { id: string; name: string; email: string };
}

export interface CreateProposalInput {
  content?: string;
}

export interface UpdateProposalInput {
  content?: string;
  pricing_snapshot?: any;
}

export interface ProposalListResponse {
  proposals: ProposalWithRelations[];
  total: number;
}

// MSA types
export interface MsaVersion {
  id: string;
  version: string;
  content: string;
  effective_date: string;
  is_current: boolean;
  change_summary: string | null;
  created_by_id: string;
  created_at: string;
  updated_at: string;
}

export interface MsaVersionWithRelations extends MsaVersion {
  created_by?: { id: string; name: string; email: string };
  signatures_count?: number;
}

export interface CreateMsaVersionInput {
  version: string;
  content: string;
  effective_date: string;
  is_current?: boolean;
  change_summary?: string;
}

export interface UpdateMsaVersionInput {
  version?: string;
  content?: string;
  effective_date?: string;
  is_current?: boolean;
  change_summary?: string;
}

export interface MsaVersionListResponse {
  msa_versions: MsaVersionWithRelations[];
  total: number;
}

// Client MSA Signature
export interface ClientMsaSignature {
  id: string;
  client_id: string;
  msa_version_id: string;
  signed_at: string;
  signer_name: string;
  signer_email: string;
  signer_ip: string | null;
  signer_user_agent: string | null;
  portal_token: string | null;
  created_at: string;
}

export interface ClientMsaSignatureWithRelations extends ClientMsaSignature {
  client?: { id: string; name: string };
  msa_version?: { id: string; version: string };
}

// Contract types
export type ContractStatus = 'draft' | 'sent' | 'signed';

export interface Contract {
  id: string;
  accord_id: string;
  version: number;
  content: string;
  msa_version_id: string;
  status: ContractStatus;
  pricing_snapshot: any;
  sent_at: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  content_snapshot: string | null;
  portal_token: string | null;
  portal_token_expires_at: string | null;
  created_by_id: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContractWithRelations extends Contract {
  accord?: { id: string; name: string; status: AccordStatus };
  msa_version?: { id: string; version: string };
  created_by?: { id: string; name: string; email: string };
}

export interface CreateContractInput {
  msa_version_id: string;
  content?: string;
}

export interface UpdateContractInput {
  content?: string;
}

export interface ContractListResponse {
  contracts: ContractWithRelations[];
  total: number;
}

// Charter types
export type CharterStatus = 'active' | 'paused' | 'cancelled';

export interface Charter {
  id: string;
  name: string;
  client_id: string;
  accord_id: string | null;
  status: CharterStatus;
  billing_period: CharterBillingPeriod;
  budget_hours: number | null;
  hourly_rate: number | null;
  budget_amount: number | null;
  start_date: string;
  end_date: string | null;
  paused_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_by_id: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface CharterWareItem {
  id: string;
  charter_id: string;
  ware_id: string;
  ware?: { id: string; name: string; type: WareType };
  price: number;
  is_active: boolean;
  deactivated_at: string | null;
  addendum_id: string | null;
  scheduled_tasks?: CharterScheduledTaskItem[];
  created_at: string;
  updated_at: string;
}

export interface CharterScheduledTaskItem {
  id: string;
  charter_id: string;
  charter_ware_id: string | null;
  sop_id: string;
  sop?: { id: string; title: string };
  cadence: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CharterCommissionItem {
  id: string;
  charter_id: string;
  commission_id: string;
  commission?: { id: string; name: string; status: string };
  allocated_hours_per_period: number | null;
  start_period: string;
  end_period: string | null;
  is_active: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CharterWithRelations extends Charter {
  client?: { id: string; name: string; status: string };
  accord?: { id: string; name: string; status: string } | null;
  created_by?: { id: string; name: string };
  charter_wares?: CharterWareItem[];
  scheduled_tasks?: CharterScheduledTaskItem[];
  charter_commissions?: CharterCommissionItem[];
  tasks_count?: number;
}

export interface CreateCharterInput {
  name: string;
  client_id: string;
  accord_id?: string;
  billing_period: CharterBillingPeriod;
  budget_hours?: number;
  hourly_rate?: number;
  budget_amount?: number;
  start_date: string;
  end_date?: string;
}

export interface UpdateCharterInput {
  name?: string;
  accord_id?: string | null;
  billing_period?: CharterBillingPeriod;
  budget_hours?: number | null;
  hourly_rate?: number | null;
  budget_amount?: number | null;
  start_date?: string;
  end_date?: string | null;
}

export interface CharterListResponse {
  charters: CharterWithRelations[];
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

export type MaintenanceFrequency = 'monthly' | 'bi_monthly' | 'quarterly' | 'semi_annually' | 'annually';

export interface MaintenancePlanSop {
  id: string;
  title: string;
  sort_order: number;
}

export interface MaintenancePlan {
  id: string;
  name: string;
  rate: number;
  agency_rate: number | null;
  hours: number | null;
  details: string | null;
  frequency: MaintenanceFrequency;
  is_active: boolean;
  sites_count?: number;
  sops_count?: number;
  sop_ids?: string[];
  sops?: MaintenancePlanSop[];
  created_at?: string;
  updated_at?: string;
}

export interface CreateMaintenancePlanInput {
  name: string;
  rate: number;
  agency_rate?: number | null;
  hours?: number | null;
  details?: string | null;
  frequency?: MaintenanceFrequency;
  is_active?: boolean;
  sop_ids?: string[];
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

// UserFunction - tracks which functions a user is qualified to perform
export interface UserFunction {
  id: string;
  user_id: string;
  function_id: string;
  function?: { id: string; name: string };
  is_primary: boolean;
  created_at?: string;
}

export interface UserFunctionWithDetails extends UserFunction {
  user?: { id: string; name: string; email: string };
}

export interface AddUserFunctionInput {
  function_id: string;
  is_primary?: boolean;
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
  license_key?: string | null;
  is_active?: boolean;
}

export interface UpdateToolInput extends Partial<CreateToolInput> {}

export interface ToolListResponse {
  tools: Tool[];
  categories: string[];
}

// Addendum types
export type AddendumStatus = 'draft' | 'sent' | 'accepted' | 'rejected' | 'changes_requested';

export interface Addendum {
  id: string;
  accord_id: string;
  version: number;
  title: string;
  description: string;
  contract_content: string;
  status: AddendumStatus;
  pricing_snapshot: any;
  changes: any;
  sent_at: string | null;
  client_responded_at: string | null;
  client_note: string | null;
  signed_at: string | null;
  signer_name: string | null;
  signer_email: string | null;
  content_snapshot: string | null;
  portal_token: string | null;
  portal_token_expires_at: string | null;
  is_override: boolean;
  override_reason: string | null;
  overridden_by_id: string | null;
  created_by_id: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AddendumWithRelations extends Addendum {
  accord?: { id: string; name: string; status: AccordStatus };
  created_by?: { id: string; name: string; email: string };
  overridden_by?: { id: string; name: string } | null;
  charter_items?: AccordCharterItem[];
  commission_items?: AccordCommissionItem[];
  keep_items?: AccordKeepItem[];
}

export interface CreateAddendumInput {
  title: string;
  description: string;
  contract_content: string;
  changes: any;
  pricing_snapshot: any;
  is_override?: boolean;
  override_reason?: string;
}

export interface UpdateAddendumInput {
  title?: string;
  description?: string;
  contract_content?: string;
  changes?: any;
  pricing_snapshot?: any;
}

export interface AddendumListResponse {
  addendums: AddendumWithRelations[];
  total: number;
}

// Sales Automation Rule types
export type AutomationTriggerType = 'status_change' | 'time_based';
export type AutomationAssigneeRule = 'accord_owner' | 'meeting_attendees' | 'specific_user';

export interface TaskTemplate {
  title: string;
  description?: string;
  priority?: number;
  function_id?: string;
  due_offset_hours?: number;
}

export interface SalesAutomationRule {
  id: string;
  name: string;
  trigger_type: AutomationTriggerType;
  trigger_status: AccordStatus;
  trigger_from_status: AccordStatus | null;
  time_threshold_hours: number | null;
  action_type: string;
  task_template: TaskTemplate;
  assignee_rule: AutomationAssigneeRule;
  assignee_user_id: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface SalesAutomationRuleWithRelations extends SalesAutomationRule {
  assignee_user?: { id: string; name: string; email: string } | null;
}

export interface CreateAutomationRuleInput {
  name: string;
  trigger_type: AutomationTriggerType;
  trigger_status: AccordStatus;
  trigger_from_status?: AccordStatus;
  time_threshold_hours?: number;
  action_type?: string;
  task_template: TaskTemplate;
  assignee_rule: AutomationAssigneeRule;
  assignee_user_id?: string;
  is_active?: boolean;
  sort_order?: number;
}

export interface UpdateAutomationRuleInput {
  name?: string;
  trigger_type?: AutomationTriggerType;
  trigger_status?: AccordStatus;
  trigger_from_status?: AccordStatus | null;
  time_threshold_hours?: number | null;
  action_type?: string;
  task_template?: TaskTemplate;
  assignee_rule?: AutomationAssigneeRule;
  assignee_user_id?: string | null;
  is_active?: boolean;
  sort_order?: number;
}

export interface AutomationRuleListResponse {
  rules: SalesAutomationRuleWithRelations[];
  total: number;
}

// Meeting types
export interface Meeting {
  id: string;
  title: string;
  client_id: string;
  meeting_date: string;
  summary: string | null;
  notes: string | null;
  transcript_url: string | null;
  recording_url: string | null;
  client_attendees: string | null;
  transcript_not_available: boolean;
  recording_not_available: boolean;
  created_by_id: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface MeetingAttendee {
  id: string;
  meeting_id: string;
  user_id: string;
  user?: { id: string; name: string; email: string };
  created_at: string;
}

export interface MeetingAssociation {
  id: string;
  meeting_id: string;
  created_at: string;
}

export interface MeetingAccordAssociation extends MeetingAssociation {
  accord_id: string;
  accord?: { id: string; name: string; status: AccordStatus };
}

export interface MeetingProjectAssociation extends MeetingAssociation {
  project_id: string;
  project?: { id: string; name: string };
}

export interface MeetingCharterAssociation extends MeetingAssociation {
  charter_id: string;
  charter?: { id: string; name: string };
}

export interface MeetingWithRelations extends Meeting {
  client?: { id: string; name: string; status: string } | null;
  created_by?: { id: string; name: string; email: string; avatar_url: string | null } | null;
  attendees?: MeetingAttendee[];
  meeting_accords?: MeetingAccordAssociation[];
  meeting_projects?: MeetingProjectAssociation[];
  meeting_charters?: MeetingCharterAssociation[];
  tasks?: { id: string; title: string; status: string; priority: number; assignee?: { id: string; name: string } | null }[];
  _count?: { tasks: number };
}

export interface CreateMeetingInput {
  title: string;
  client_id: string;
  meeting_date: string;
  summary?: string | null;
  notes?: string | null;
  transcript_url?: string | null;
  recording_url?: string | null;
  client_attendees?: string | null;
  attendee_ids?: string[];
  accord_ids?: string[];
  project_ids?: string[];
  charter_ids?: string[];
}

export interface UpdateMeetingInput {
  title?: string;
  client_id?: string;
  meeting_date?: string;
  summary?: string | null;
  notes?: string | null;
  transcript_url?: string | null;
  recording_url?: string | null;
  client_attendees?: string | null;
  transcript_not_available?: boolean;
  recording_not_available?: boolean;
}

export interface MeetingListResponse {
  meetings: MeetingWithRelations[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
