/**
 * API Route Registry
 *
 * Structured definitions of all API endpoints. Consumed by GET /api/docs
 * to provide self-documenting API discovery for LLM agents and external tools.
 *
 * IMPORTANT: Update this file whenever you add, modify, or remove an API endpoint.
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
}

export interface ApiEndpoint {
  path: string;
  methods: MethodDef[];
}

export const apiRegistry: ApiEndpoint[] = [
  // ── Auth ──────────────────────────────────────────
  {
    path: '/api/auth/login',
    methods: [
      {
        method: 'POST',
        summary: 'Authenticate user with email and password. Sets HTTP-only cookies.',
        auth: 'none',
        bodySchema: [
          { name: 'email', type: 'string', required: true, description: 'User email' },
          { name: 'password', type: 'string', required: true, description: 'User password' },
        ],
      },
    ],
  },
  {
    path: '/api/auth/logout',
    methods: [
      { method: 'POST', summary: 'Clear auth cookies and delete session.', auth: 'required' },
    ],
  },
  {
    path: '/api/auth/me',
    methods: [
      {
        method: 'GET',
        summary: 'Get current authenticated user profile with preferences.',
        auth: 'required',
        responseExample: {
          user: { id: 'uuid', name: 'string', email: 'string', role: 'tech|pm|admin', avatar_url: 'string|null' },
        },
      },
    ],
  },
  {
    path: '/api/auth/refresh',
    methods: [
      { method: 'POST', summary: 'Refresh access token using refresh token cookie.', auth: 'none' },
    ],
  },
  {
    path: '/api/auth/forgot-password',
    methods: [
      {
        method: 'POST',
        summary: 'Initiate password reset. Sends email with reset link.',
        auth: 'none',
        bodySchema: [
          { name: 'email', type: 'string', required: true, description: 'User email' },
        ],
      },
    ],
  },
  {
    path: '/api/auth/reset-password',
    methods: [
      {
        method: 'POST',
        summary: 'Complete password reset with token from email.',
        auth: 'none',
        bodySchema: [
          { name: 'token', type: 'string', required: true, description: 'Reset token from email' },
          { name: 'password', type: 'string', required: true, description: 'New password' },
        ],
      },
    ],
  },

  // ── API Keys ──────────────────────────────────────
  {
    path: '/api/api-keys',
    methods: [
      {
        method: 'GET',
        summary: 'List current user\'s API keys (excludes revoked).',
        auth: 'required',
        responseExample: {
          api_keys: [{ id: 'uuid', name: 'string', key_prefix: 'citadel_abcd1234', last_used_at: 'ISO-8601|null', expires_at: 'ISO-8601|null', created_at: 'ISO-8601' }],
        },
      },
      {
        method: 'POST',
        summary: 'Create a new API key. The full key is returned ONLY in this response.',
        auth: 'required',
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Descriptive name for the key (max 100 chars)' },
          { name: 'expires_at', type: 'ISO-8601', required: false, description: 'Optional expiration date' },
        ],
        responseExample: {
          id: 'uuid',
          name: 'string',
          key: 'citadel_<full-key-shown-once>',
          key_prefix: 'citadel_abcd1234',
          expires_at: 'ISO-8601|null',
          created_at: 'ISO-8601',
        },
      },
    ],
  },
  {
    path: '/api/api-keys/:id',
    methods: [
      {
        method: 'DELETE',
        summary: 'Revoke an API key (soft delete). Key immediately stops working.',
        auth: 'required',
      },
    ],
  },

  // ── Dashboard ─────────────────────────────────────
  {
    path: '/api/dashboard',
    methods: [
      {
        method: 'GET',
        summary: 'Get role-specific dashboard data (tasks, metrics, alerts). Returns different data based on user role.',
        auth: 'required',
      },
    ],
  },
  {
    path: '/api/dashboard/timeclock-issues',
    methods: [
      {
        method: 'GET',
        summary: 'Get completed tasks missing time entries and currently running timers.',
        auth: 'required',
      },
    ],
  },
  {
    path: '/api/dashboard/load-more',
    methods: [
      {
        method: 'GET',
        summary: 'Load additional items for dashboard lists.',
        auth: 'required',
        queryParams: [
          { name: 'section', type: 'string', required: true, description: 'Dashboard section to load more from' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
        ],
      },
    ],
  },

  // ── Clients ───────────────────────────────────────
  {
    path: '/api/clients',
    methods: [
      {
        method: 'GET',
        summary: 'List clients with pagination, search, and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by name' },
          { name: 'status', type: 'string', required: false, description: 'Filter: active, inactive, delinquent' },
          { name: 'type', type: 'string', required: false, description: 'Filter: direct, agency_partner, sub_client' },
          { name: 'page', type: 'number', required: false, description: 'Page number (default 1)' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page (default 50)' },
        ],
      },
      {
        method: 'POST',
        summary: 'Create a new client.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Client name' },
          { name: 'type', type: 'string', required: false, description: 'direct, agency_partner, sub_client' },
          { name: 'status', type: 'string', required: false, description: 'active, inactive, delinquent' },
          { name: 'primary_contact', type: 'string', required: false, description: 'Contact name' },
          { name: 'email', type: 'string', required: false, description: 'Contact email' },
          { name: 'phone', type: 'string', required: false, description: 'Contact phone' },
          { name: 'retainer_hours', type: 'number', required: false, description: 'Monthly retainer hours' },
          { name: 'hourly_rate', type: 'number', required: false, description: 'Hourly rate' },
          { name: 'parent_agency_id', type: 'uuid', required: false, description: 'Parent agency client ID' },
          { name: 'notes', type: 'string', required: false, description: 'Notes' },
        ],
      },
    ],
  },
  {
    path: '/api/clients/:id',
    methods: [
      {
        method: 'GET',
        summary: 'Get client details including sites and sub-clients.',
        auth: 'required',
      },
      {
        method: 'PATCH',
        summary: 'Update a client.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: false, description: 'Client name' },
          { name: 'status', type: 'string', required: false, description: 'active, inactive, delinquent' },
          { name: 'type', type: 'string', required: false, description: 'direct, agency_partner, sub_client' },
          { name: 'primary_contact', type: 'string', required: false, description: 'Contact name' },
          { name: 'email', type: 'string', required: false, description: 'Contact email' },
          { name: 'phone', type: 'string', required: false, description: 'Contact phone' },
          { name: 'retainer_hours', type: 'number', required: false, description: 'Monthly retainer hours' },
          { name: 'hourly_rate', type: 'number', required: false, description: 'Hourly rate' },
          { name: 'notes', type: 'string', required: false, description: 'Notes' },
        ],
      },
      {
        method: 'DELETE',
        summary: 'Soft delete a client.',
        auth: 'required',
        roles: ['admin'],
      },
    ],
  },
  {
    path: '/api/clients/:id/activity',
    methods: [
      {
        method: 'GET',
        summary: 'Get client activity — projects, tasks, and time entries.',
        auth: 'required',
        queryParams: [
          { name: 'projectStatus', type: 'string', required: false, description: 'Filter by project status' },
          { name: 'taskType', type: 'string', required: false, description: 'Filter task type' },
          { name: 'taskStatus', type: 'string', required: false, description: 'Filter task status' },
        ],
      },
    ],
  },
  {
    path: '/api/clients/:id/retainer',
    methods: [
      {
        method: 'GET',
        summary: 'Get client retainer usage for a specific month.',
        auth: 'required',
        queryParams: [
          { name: 'month', type: 'string', required: false, description: 'Month in YYYY-MM format (defaults to current)' },
        ],
      },
      {
        method: 'PATCH',
        summary: 'Update retainer configuration.',
        auth: 'required',
        roles: ['pm', 'admin'],
      },
    ],
  },
  {
    path: '/api/clients/bulk',
    methods: [
      { method: 'PATCH', summary: 'Bulk update clients.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Bulk soft delete clients.', auth: 'required', roles: ['admin'] },
    ],
  },

  // ── Projects ──────────────────────────────────────
  {
    path: '/api/projects',
    methods: [
      {
        method: 'GET',
        summary: 'List projects with pagination, search, and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by name' },
          { name: 'status', type: 'string', required: false, description: 'Filter by single status' },
          { name: 'statuses', type: 'string', required: false, description: 'Comma-separated status list' },
          { name: 'type', type: 'string', required: false, description: 'project, retainer, internal' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'site_id', type: 'uuid', required: false, description: 'Filter by site' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
      },
      {
        method: 'POST',
        summary: 'Create a new project.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Project name' },
          { name: 'client_id', type: 'uuid', required: true, description: 'Client ID' },
          { name: 'description', type: 'string', required: false, description: 'Project description' },
          { name: 'status', type: 'string', required: false, description: 'Initial status' },
          { name: 'type', type: 'string', required: false, description: 'project, retainer, internal' },
          { name: 'site_id', type: 'uuid', required: false, description: 'Associated site' },
          { name: 'recipe_id', type: 'uuid', required: false, description: 'Recipe template to use' },
          { name: 'start_date', type: 'ISO-8601', required: false, description: 'Start date' },
          { name: 'target_date', type: 'ISO-8601', required: false, description: 'Target completion date' },
          { name: 'billing_type', type: 'string', required: false, description: 'fixed, hourly, retainer, none' },
          { name: 'hourly_rate', type: 'number', required: false, description: 'Hourly rate for billing' },
        ],
      },
    ],
  },
  {
    path: '/api/projects/:id',
    methods: [
      {
        method: 'GET',
        summary: 'Get project details with tasks, phases, team, milestones, and calculated budget.',
        auth: 'required',
      },
      {
        method: 'PATCH',
        summary: 'Update project fields or lock budget.',
        auth: 'required',
        roles: ['pm', 'admin'],
      },
      {
        method: 'DELETE',
        summary: 'Soft delete a project.',
        auth: 'required',
        roles: ['pm', 'admin'],
      },
    ],
  },
  {
    path: '/api/projects/:id/milestones',
    methods: [
      { method: 'GET', summary: 'List milestones for a project.', auth: 'required' },
      {
        method: 'POST',
        summary: 'Create a milestone.',
        auth: 'required',
        roles: ['pm', 'admin'],
        bodySchema: [
          { name: 'name', type: 'string', required: true, description: 'Milestone name' },
          { name: 'phase_id', type: 'uuid', required: false, description: 'Optional phase link' },
          { name: 'target_date', type: 'ISO-8601', required: false, description: 'Target date' },
          { name: 'billing_amount', type: 'number', required: false, description: 'Billing amount' },
          { name: 'notes', type: 'string', required: false, description: 'Notes' },
        ],
      },
    ],
  },
  {
    path: '/api/projects/:id/phases',
    methods: [
      { method: 'POST', summary: 'Create a project phase.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'PATCH', summary: 'Update or reorder phases.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Delete a phase.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/projects/:id/tasks/reorder',
    methods: [
      { method: 'PATCH', summary: 'Reorder tasks within phases.', auth: 'required' },
    ],
  },
  {
    path: '/api/projects/:id/team',
    methods: [
      { method: 'GET', summary: 'Get project team assignments.', auth: 'required' },
      { method: 'POST', summary: 'Add team member to project.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'PATCH', summary: 'Update team assignment.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Remove team member from project.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/projects/:id/resource-links',
    methods: [
      { method: 'GET', summary: 'List project resource links (Figma, Drive, etc).', auth: 'required' },
      { method: 'POST', summary: 'Add a resource link to a project.', auth: 'required' },
    ],
  },
  {
    path: '/api/projects/wizard',
    methods: [
      {
        method: 'POST',
        summary: 'Create a project from a recipe template with phases and tasks.',
        auth: 'required',
        roles: ['pm', 'admin'],
      },
    ],
  },

  // ── Tasks ─────────────────────────────────────────
  {
    path: '/api/tasks',
    methods: [
      {
        method: 'GET',
        summary: 'List tasks with pagination, search, and filters. Tech users only see tasks from visible projects.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by title' },
          { name: 'status', type: 'string', required: false, description: 'Single status filter' },
          { name: 'statuses', type: 'string', required: false, description: 'Comma-separated status list' },
          { name: 'priority', type: 'number', required: false, description: 'Priority filter (1-5)' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Filter by project' },
          { name: 'assignee_id', type: 'uuid', required: false, description: 'Filter by assignee' },
          { name: 'phase', type: 'string', required: false, description: 'Filter by phase' },
          { name: 'my_tasks', type: 'boolean', required: false, description: 'Only tasks assigned to current user' },
          { name: 'pending_review', type: 'boolean', required: false, description: 'Tasks awaiting review approval' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
      },
      {
        method: 'POST',
        summary: 'Create a new task.',
        auth: 'required',
        bodySchema: [
          { name: 'title', type: 'string', required: true, description: 'Task title' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Project ID' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Client ID (derived from project if not set)' },
          { name: 'description', type: 'string', required: false, description: 'Task description' },
          { name: 'status', type: 'string', required: false, description: 'not_started, in_progress, review, done, blocked, abandoned' },
          { name: 'priority', type: 'number', required: false, description: '1 (highest) to 5 (lowest)' },
          { name: 'assignee_id', type: 'uuid', required: false, description: 'Assigned user' },
          { name: 'function_id', type: 'uuid', required: false, description: 'Function/department' },
          { name: 'phase_id', type: 'uuid', required: false, description: 'Project phase' },
          { name: 'energy_estimate', type: 'number', required: false, description: '1-8 energy scale' },
          { name: 'mystery_factor', type: 'string', required: false, description: 'none, average, significant, no_idea' },
          { name: 'battery_impact', type: 'string', required: false, description: 'average_drain, high_drain, energizing' },
          { name: 'due_date', type: 'ISO-8601', required: false, description: 'Due date' },
          { name: 'needs_review', type: 'boolean', required: false, description: 'Whether task needs review' },
          { name: 'reviewer_id', type: 'uuid', required: false, description: 'Reviewer user ID' },
          { name: 'sop_id', type: 'uuid', required: false, description: 'Associated SOP' },
        ],
      },
    ],
  },
  {
    path: '/api/tasks/:id',
    methods: [
      { method: 'GET', summary: 'Get task detail with project, assignee, time entries, and comments.', auth: 'required' },
      {
        method: 'PATCH',
        summary: 'Update task fields. Handles status changes, assignment, and focus toggling.',
        auth: 'required',
      },
      { method: 'DELETE', summary: 'Soft delete a task.', auth: 'required' },
    ],
  },
  {
    path: '/api/tasks/:id/comments',
    methods: [
      { method: 'GET', summary: 'List comments on a task.', auth: 'required' },
      {
        method: 'POST',
        summary: 'Add a comment to a task.',
        auth: 'required',
        bodySchema: [
          { name: 'content', type: 'string', required: true, description: 'Comment text' },
        ],
      },
    ],
  },
  {
    path: '/api/tasks/:id/dependencies',
    methods: [
      { method: 'POST', summary: 'Add a task dependency (blocked_by relationship).', auth: 'required' },
      { method: 'DELETE', summary: 'Remove a task dependency.', auth: 'required' },
    ],
  },
  {
    path: '/api/tasks/:id/move',
    methods: [
      { method: 'PATCH', summary: 'Move a task to a different phase.', auth: 'required' },
    ],
  },
  {
    path: '/api/tasks/:id/billing',
    methods: [
      { method: 'PATCH', summary: 'Update task billing info (invoiced, billable, billing_target).', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/tasks/bulk',
    methods: [
      { method: 'PATCH', summary: 'Bulk update tasks (status, assignee, priority, etc).', auth: 'required' },
      { method: 'DELETE', summary: 'Bulk soft delete tasks.', auth: 'required' },
    ],
  },

  // ── Time Entries ──────────────────────────────────
  {
    path: '/api/time-entries',
    methods: [
      {
        method: 'GET',
        summary: 'List time entries with pagination and filters.',
        auth: 'required',
        queryParams: [
          { name: 'user_id', type: 'uuid', required: false, description: 'Filter by user' },
          { name: 'task_id', type: 'uuid', required: false, description: 'Filter by task' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Filter by project' },
          { name: 'start_date', type: 'ISO-8601', required: false, description: 'From date' },
          { name: 'end_date', type: 'ISO-8601', required: false, description: 'To date' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
      },
      {
        method: 'POST',
        summary: 'Create a manual time entry.',
        auth: 'required',
        bodySchema: [
          { name: 'task_id', type: 'uuid', required: false, description: 'Task ID' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Project ID' },
          { name: 'started_at', type: 'ISO-8601', required: true, description: 'Start time' },
          { name: 'ended_at', type: 'ISO-8601', required: false, description: 'End time' },
          { name: 'duration', type: 'number', required: false, description: 'Duration in minutes' },
          { name: 'description', type: 'string', required: false, description: 'Description' },
          { name: 'is_billable', type: 'boolean', required: false, description: 'Whether billable' },
        ],
      },
    ],
  },
  {
    path: '/api/time-entries/:id',
    methods: [
      { method: 'GET', summary: 'Get a time entry.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a time entry.', auth: 'required' },
      { method: 'DELETE', summary: 'Soft delete a time entry.', auth: 'required' },
    ],
  },
  {
    path: '/api/time-entries/active',
    methods: [
      { method: 'GET', summary: 'Get the current user\'s running timer (if any).', auth: 'required' },
    ],
  },
  {
    path: '/api/time-entries/start',
    methods: [
      {
        method: 'POST',
        summary: 'Start a new timer. Stops any existing running timer first.',
        auth: 'required',
        bodySchema: [
          { name: 'task_id', type: 'uuid', required: false, description: 'Task to track time for' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Project ID' },
          { name: 'description', type: 'string', required: false, description: 'Description' },
        ],
      },
    ],
  },
  {
    path: '/api/time-entries/:id/stop',
    methods: [
      { method: 'POST', summary: 'Stop a running timer and calculate duration.', auth: 'required' },
    ],
  },

  // ── Comments ──────────────────────────────────────
  {
    path: '/api/comments/:id',
    methods: [
      { method: 'GET', summary: 'Get a single comment.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a comment.', auth: 'required' },
      { method: 'DELETE', summary: 'Soft delete a comment.', auth: 'required' },
    ],
  },

  // ── Sites ─────────────────────────────────────────
  {
    path: '/api/sites',
    methods: [
      {
        method: 'GET',
        summary: 'List sites with pagination, search, and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by name' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
      },
      {
        method: 'POST',
        summary: 'Create a new site.',
        auth: 'required',
        roles: ['pm', 'admin'],
      },
    ],
  },
  {
    path: '/api/sites/:id',
    methods: [
      { method: 'GET', summary: 'Get site details with domains, hosting plan, and maintenance info.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a site.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Soft delete a site.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/sites/bulk',
    methods: [
      { method: 'PATCH', summary: 'Bulk update sites.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Bulk soft delete sites.', auth: 'required', roles: ['admin'] },
    ],
  },

  // ── Domains ───────────────────────────────────────
  {
    path: '/api/domains',
    methods: [
      {
        method: 'GET',
        summary: 'List domains with pagination, search, and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by name' },
          { name: 'site_id', type: 'uuid', required: false, description: 'Filter by site' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
      },
      { method: 'POST', summary: 'Create a new domain.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/domains/:id',
    methods: [
      { method: 'GET', summary: 'Get domain details.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a domain.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Soft delete a domain.', auth: 'required', roles: ['admin'] },
    ],
  },

  // ── Milestones ────────────────────────────────────
  {
    path: '/api/milestones/:id',
    methods: [
      { method: 'GET', summary: 'Get a milestone.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a milestone.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Delete a milestone.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/milestones/:id/trigger',
    methods: [
      { method: 'POST', summary: 'Trigger milestone billing (mark as ready to invoice).', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/milestones/:id/invoice',
    methods: [
      { method: 'POST', summary: 'Mark a milestone as invoiced.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },

  // ── SOPs ──────────────────────────────────────────
  {
    path: '/api/sops',
    methods: [
      {
        method: 'GET',
        summary: 'List SOPs with pagination and filters.',
        auth: 'required',
        queryParams: [
          { name: 'search', type: 'string', required: false, description: 'Search by title' },
          { name: 'function_id', type: 'uuid', required: false, description: 'Filter by function' },
          { name: 'is_active', type: 'boolean', required: false, description: 'Filter by active status' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
      },
      { method: 'POST', summary: 'Create a new SOP.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/sops/:id',
    methods: [
      { method: 'GET', summary: 'Get SOP details with content and requirements.', auth: 'required' },
      { method: 'PATCH', summary: 'Update an SOP.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Soft delete an SOP.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/sops/bulk',
    methods: [
      { method: 'PATCH', summary: 'Bulk update SOPs.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Bulk soft delete SOPs.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },

  // ── Recipes ───────────────────────────────────────
  {
    path: '/api/recipes',
    methods: [
      { method: 'GET', summary: 'List recipe templates.', auth: 'required' },
      { method: 'POST', summary: 'Create a recipe template.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/recipes/:id',
    methods: [
      { method: 'GET', summary: 'Get recipe with phases and tasks.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a recipe.', auth: 'required', roles: ['pm', 'admin'] },
      { method: 'DELETE', summary: 'Delete a recipe.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/recipes/:id/phases',
    methods: [
      { method: 'GET', summary: 'List recipe phases.', auth: 'required' },
      { method: 'POST', summary: 'Create a recipe phase.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/recipes/:id/phases/:phaseId/tasks',
    methods: [
      { method: 'GET', summary: 'List tasks in a recipe phase.', auth: 'required' },
      { method: 'POST', summary: 'Add a task to a recipe phase.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },

  // ── Users ─────────────────────────────────────────
  {
    path: '/api/users',
    methods: [
      {
        method: 'GET',
        summary: 'List users.',
        auth: 'required',
        queryParams: [
          { name: 'include_inactive', type: 'boolean', required: false, description: 'Include inactive users' },
        ],
      },
      {
        method: 'POST',
        summary: 'Create a new user.',
        auth: 'required',
        roles: ['admin'],
      },
    ],
  },
  {
    path: '/api/users/:id',
    methods: [
      { method: 'GET', summary: 'Get user details.', auth: 'required' },
      { method: 'PATCH', summary: 'Update user or reset password.', auth: 'required', roles: ['admin'] },
      { method: 'DELETE', summary: 'Delete or deactivate a user.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/users/:id/functions',
    methods: [
      { method: 'GET', summary: 'Get user function specialties.', auth: 'required' },
      { method: 'POST', summary: 'Set user function specialties.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/users/me',
    methods: [
      { method: 'GET', summary: 'Get current user profile.', auth: 'required' },
      { method: 'PATCH', summary: 'Update current user profile (name, avatar).', auth: 'required' },
    ],
  },
  {
    path: '/api/users/me/preferences',
    methods: [
      { method: 'GET', summary: 'Get current user preferences (theme, naming convention).', auth: 'required' },
      { method: 'PATCH', summary: 'Update user preferences.', auth: 'required' },
    ],
  },
  {
    path: '/api/users/me/notification-preferences',
    methods: [
      { method: 'GET', summary: 'Get notification preferences matrix.', auth: 'required' },
      { method: 'PATCH', summary: 'Update notification preferences.', auth: 'required' },
    ],
  },

  // ── Notifications ─────────────────────────────────
  {
    path: '/api/notifications',
    methods: [
      {
        method: 'GET',
        summary: 'List notifications for current user.',
        auth: 'required',
        queryParams: [
          { name: 'is_read', type: 'boolean', required: false, description: 'Filter by read status' },
          { name: 'page', type: 'number', required: false, description: 'Page number' },
          { name: 'limit', type: 'number', required: false, description: 'Items per page' },
        ],
      },
    ],
  },
  {
    path: '/api/notifications/:id',
    methods: [
      { method: 'PATCH', summary: 'Mark notification as read.', auth: 'required' },
      { method: 'DELETE', summary: 'Delete a notification.', auth: 'required' },
    ],
  },
  {
    path: '/api/notifications/unread-count',
    methods: [
      { method: 'GET', summary: 'Get count of unread notifications.', auth: 'required' },
    ],
  },
  {
    path: '/api/notifications/mark-all-read',
    methods: [
      { method: 'POST', summary: 'Mark all notifications as read.', auth: 'required' },
    ],
  },

  // ── Billing ───────────────────────────────────────
  {
    path: '/api/billing/unbilled',
    methods: [
      { method: 'GET', summary: 'Get all unbilled tasks and milestones grouped by client.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/billing/batch-invoice',
    methods: [
      { method: 'POST', summary: 'Mark multiple tasks and milestones as invoiced.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },

  // ── Reports ───────────────────────────────────────
  {
    path: '/api/reports/retainers',
    methods: [
      { method: 'GET', summary: 'Get retainer usage report across all retainer clients.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },
  {
    path: '/api/reports/retainers/:clientId',
    methods: [
      { method: 'GET', summary: 'Get retainer report for a specific client.', auth: 'required' },
    ],
  },
  {
    path: '/api/reports/time',
    methods: [
      {
        method: 'GET',
        summary: 'Get time tracking report with filters.',
        auth: 'required',
        queryParams: [
          { name: 'start_date', type: 'ISO-8601', required: false, description: 'From date' },
          { name: 'end_date', type: 'ISO-8601', required: false, description: 'To date' },
          { name: 'user_id', type: 'uuid', required: false, description: 'Filter by user' },
          { name: 'client_id', type: 'uuid', required: false, description: 'Filter by client' },
          { name: 'project_id', type: 'uuid', required: false, description: 'Filter by project' },
        ],
      },
    ],
  },
  {
    path: '/api/reports/utilization',
    methods: [
      { method: 'GET', summary: 'Get team utilization report.', auth: 'required', roles: ['pm', 'admin'] },
    ],
  },

  // ── Reference Data ────────────────────────────────
  {
    path: '/api/functions',
    methods: [
      { method: 'GET', summary: 'List functions/departments.', auth: 'required' },
      { method: 'POST', summary: 'Create a function.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/functions/:id',
    methods: [
      { method: 'GET', summary: 'Get function details.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a function.', auth: 'required', roles: ['admin'] },
      { method: 'DELETE', summary: 'Delete a function.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/hosting-plans',
    methods: [
      { method: 'GET', summary: 'List hosting plans.', auth: 'required' },
      { method: 'POST', summary: 'Create a hosting plan.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/hosting-plans/:id',
    methods: [
      { method: 'GET', summary: 'Get hosting plan details.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a hosting plan.', auth: 'required', roles: ['admin'] },
      { method: 'DELETE', summary: 'Delete a hosting plan (fails if in use).', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/maintenance-plans',
    methods: [
      { method: 'GET', summary: 'List maintenance plans.', auth: 'required' },
      { method: 'POST', summary: 'Create a maintenance plan.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/maintenance-plans/:id',
    methods: [
      { method: 'GET', summary: 'Get maintenance plan with linked SOPs.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a maintenance plan.', auth: 'required', roles: ['admin'] },
      { method: 'DELETE', summary: 'Delete a maintenance plan.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/maintenance-plans/:id/sops',
    methods: [
      { method: 'GET', summary: 'List SOPs linked to a maintenance plan.', auth: 'required' },
      { method: 'POST', summary: 'Link/unlink SOPs to a maintenance plan.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/dns-providers',
    methods: [
      { method: 'GET', summary: 'List DNS providers.', auth: 'required' },
      { method: 'POST', summary: 'Create a DNS provider.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/tools',
    methods: [
      { method: 'GET', summary: 'List tools.', auth: 'required' },
      { method: 'POST', summary: 'Create a tool.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/tools/:id',
    methods: [
      { method: 'GET', summary: 'Get tool details.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a tool.', auth: 'required', roles: ['admin'] },
      { method: 'DELETE', summary: 'Delete a tool.', auth: 'required', roles: ['admin'] },
    ],
  },

  // ── Resource Links ────────────────────────────────
  {
    path: '/api/resource-links/:id',
    methods: [
      { method: 'GET', summary: 'Get a resource link.', auth: 'required' },
      { method: 'PATCH', summary: 'Update a resource link.', auth: 'required' },
      { method: 'DELETE', summary: 'Delete a resource link.', auth: 'required' },
    ],
  },

  // ── Activities ────────────────────────────────────
  {
    path: '/api/activities',
    methods: [
      {
        method: 'GET',
        summary: 'List activity log entries.',
        auth: 'required',
        queryParams: [
          { name: 'entity_type', type: 'string', required: false, description: 'Filter by entity type' },
          { name: 'entity_id', type: 'uuid', required: false, description: 'Filter by entity ID' },
          { name: 'user_id', type: 'uuid', required: false, description: 'Filter by user' },
        ],
      },
    ],
  },

  // ── Search ────────────────────────────────────────
  {
    path: '/api/search',
    methods: [
      {
        method: 'GET',
        summary: 'Global search across clients, sites, projects, tasks, SOPs, domains, and tools.',
        auth: 'required',
        queryParams: [
          { name: 'q', type: 'string', required: true, description: 'Search query' },
          { name: 'type', type: 'string', required: false, description: 'Limit to specific entity type' },
        ],
      },
    ],
  },

  // ── Uploads ───────────────────────────────────────
  {
    path: '/api/uploads',
    methods: [
      { method: 'POST', summary: 'Upload a file (avatar, attachment). Accepts multipart/form-data.', auth: 'required' },
    ],
  },

  // ── Bug Report ────────────────────────────────────
  {
    path: '/api/bug-report',
    methods: [
      { method: 'POST', summary: 'Submit a bug report (creates task and/or sends email).', auth: 'required' },
    ],
  },

  // ── Admin ─────────────────────────────────────────
  {
    path: '/api/admin/integrations',
    methods: [
      { method: 'GET', summary: 'List configured integrations with masked API keys.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/integrations/:provider',
    methods: [
      { method: 'GET', summary: 'Get integration configuration for a provider.', auth: 'required', roles: ['admin'] },
      { method: 'PATCH', summary: 'Update integration configuration.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/integrations/sendgrid/test',
    methods: [
      { method: 'POST', summary: 'Test SendGrid email integration.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/integrations/slack/test',
    methods: [
      { method: 'POST', summary: 'Test Slack bot integration.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/slack/users',
    methods: [
      { method: 'GET', summary: 'List Slack workspace users.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/slack/mappings',
    methods: [
      { method: 'GET', summary: 'List Citadel-to-Slack user mappings.', auth: 'required', roles: ['admin'] },
      { method: 'POST', summary: 'Create or auto-match Slack user mappings.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/slack/mappings/:userId',
    methods: [
      { method: 'GET', summary: 'Get Slack mapping for a user.', auth: 'required', roles: ['admin'] },
      { method: 'PATCH', summary: 'Update Slack mapping.', auth: 'required', roles: ['admin'] },
      { method: 'DELETE', summary: 'Remove Slack mapping.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/users/:id/notification-preferences',
    methods: [
      { method: 'GET', summary: 'Get user notification preferences (admin view).', auth: 'required', roles: ['admin'] },
      { method: 'PATCH', summary: 'Set user notification preferences with admin override.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/database/tables',
    methods: [
      { method: 'GET', summary: 'List available table groups for database export/import.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/database/export',
    methods: [
      { method: 'POST', summary: 'Export database tables as SQL file.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/database/import',
    methods: [
      { method: 'POST', summary: 'Import SQL database dump file.', auth: 'required', roles: ['admin'] },
    ],
  },
  {
    path: '/api/admin/maintenance/generate',
    methods: [
      { method: 'POST', summary: 'Manually trigger maintenance task generation.', auth: 'required', roles: ['admin'] },
    ],
  },

  // ── Settings ──────────────────────────────────────
  {
    path: '/api/settings/bug-report',
    methods: [
      { method: 'POST', summary: 'Configure bug report settings (project, phase, notify user).', auth: 'required', roles: ['admin'] },
    ],
  },

  // ── Webhooks ──────────────────────────────────────
  {
    path: '/api/webhooks/slack/events',
    methods: [
      { method: 'POST', summary: 'Handle incoming Slack webhook events (thread replies sync).', auth: 'none' },
    ],
  },

  // ── Cron Jobs ─────────────────────────────────────
  {
    path: '/api/cron/retainer-alerts',
    methods: [
      { method: 'POST', summary: 'Check retainer usage and send alerts for clients approaching limits.', auth: 'cron' },
    ],
  },
  {
    path: '/api/cron/maintenance',
    methods: [
      { method: 'POST', summary: 'Generate maintenance tasks for the current period.', auth: 'cron' },
    ],
  },
  {
    path: '/api/cron/task-due-soon',
    methods: [
      { method: 'POST', summary: 'Notify assignees about tasks due within 24 hours.', auth: 'cron' },
    ],
  },
  {
    path: '/api/cron/email-digest',
    methods: [
      { method: 'POST', summary: 'Process and send email digest notifications.', auth: 'cron' },
    ],
  },
  {
    path: '/api/cron/slack-batches',
    methods: [
      { method: 'POST', summary: 'Process and send batched Slack notifications.', auth: 'cron' },
    ],
  },

  // ── Docs ──────────────────────────────────────────
  {
    path: '/api/docs',
    methods: [
      { method: 'GET', summary: 'Get API documentation (this registry). Returns all endpoints with methods, params, and descriptions.', auth: 'required' },
    ],
  },
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
