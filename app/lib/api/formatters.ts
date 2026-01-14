export function formatClientResponse(client: any) {
  return {
    id: client.id,
    name: client.name,
    type: client.type,
    status: client.status,
    primary_contact: client.primary_contact,
    email: client.email,
    phone: client.phone,
    retainer_hours: client.retainer_hours ? Number(client.retainer_hours) : null,
    hourly_rate: client.hourly_rate ? Number(client.hourly_rate) : null,
    parent_agency_id: client.parent_agency_id,
    parent_agency: client.parent_agency || null,
    notes: client.notes,
    sites_count: client._count?.sites ?? client.sites?.length ?? 0,
    sub_clients_count: client._count?.sub_clients ?? 0,
    sites: client.sites?.map(formatSiteResponse),
    sub_clients: client.sub_clients,
    is_deleted: client.is_deleted,
    created_at: client.created_at,
    updated_at: client.updated_at,
  };
}

export function formatSiteResponse(site: any) {
  // Find the primary domain (is_primary and not deleted)
  const primaryDomain = site.domains?.find(
    (d: any) => d.is_primary && !d.is_deleted
  );

  return {
    id: site.id,
    name: site.name,
    url: site.url, // Keep for backward compat, but derived from primary_domain in UI
    client_id: site.client_id,
    client: site.client ? { id: site.client.id, name: site.client.name } : null,
    hosted_by: site.hosted_by,
    platform: site.platform,
    hosting_plan_id: site.hosting_plan_id,
    hosting_plan: site.hosting_plan
      ? {
          id: site.hosting_plan.id,
          name: site.hosting_plan.name,
          rate: Number(site.hosting_plan.rate),
        }
      : null,
    hosting_discount: site.hosting_discount ? Number(site.hosting_discount) : null,
    maintenance_plan_id: site.maintenance_plan_id,
    maintenance_plan: site.maintenance_plan
      ? {
          id: site.maintenance_plan.id,
          name: site.maintenance_plan.name,
          rate: Number(site.maintenance_plan.rate),
          frequency: site.maintenance_plan.frequency,
        }
      : null,
    maintenance_assignee_id: site.maintenance_assignee_id,
    maintenance_assignee: site.maintenance_assignee
      ? {
          id: site.maintenance_assignee.id,
          name: site.maintenance_assignee.name,
          email: site.maintenance_assignee.email,
        }
      : null,
    notes: site.notes,
    domains_count: site._count?.domains ?? site.domains?.length ?? 0,
    domains: site.domains?.map(formatDomainResponse),
    primary_domain: primaryDomain ? formatDomainResponse(primaryDomain) : null,
    is_deleted: site.is_deleted,
    created_at: site.created_at,
    updated_at: site.updated_at,
  };
}

export function formatDomainResponse(domain: any) {
  return {
    id: domain.id,
    name: domain.name,
    site_id: domain.site_id,
    site: domain.site
      ? {
          id: domain.site.id,
          name: domain.site.name,
          client: domain.site.client
            ? { id: domain.site.client.id, name: domain.site.client.name }
            : null,
        }
      : null,
    registrar: domain.registrar,
    expires_at: domain.expires_at,
    is_primary: domain.is_primary,
    // Ownership & DNS
    registered_by: domain.registered_by,
    dns_provider_id: domain.dns_provider_id,
    dns_provider: domain.dns_provider
      ? { id: domain.dns_provider.id, name: domain.dns_provider.name }
      : null,
    dns_managed_by: domain.dns_managed_by,
    notes: domain.notes,
    is_deleted: domain.is_deleted,
    created_at: domain.created_at,
    updated_at: domain.updated_at,
  };
}

export function formatProjectResponse(project: any) {
  // Import lazily to avoid circular dependencies
  const { calculateProjectEstimates } = require('@/lib/calculations/energy');
  const { calculateHealthFromTasks } = require('@/lib/calculations/project-health');

  // Calculate estimates from tasks
  const tasks = project.tasks || [];
  const estimates = calculateProjectEstimates(
    tasks.map((t: any) => ({
      status: t.status,
      energy_estimate: t.energy_estimate,
      mystery_factor: t.mystery_factor || 'none',
      estimated_minutes: t.estimated_minutes,
    })),
    0 // TODO: sum time entries when available
  );

  // Calculate health from tasks (only for active projects)
  const activeStatuses = ['ready', 'in_progress', 'review'];
  const health = activeStatuses.includes(project.status)
    ? calculateHealthFromTasks(
        tasks.map((t: any) => ({
          status: t.status,
          due_date: t.due_date,
          estimated_minutes: t.estimated_minutes,
          time_entries: t.time_entries,
        }))
      )
    : null;

  // Use _count if available
  const tasksCount = project._count?.tasks ?? tasks.length;

  return {
    id: project.id,
    name: project.name,
    description: project.description,
    status: project.status,
    type: project.type,
    client_id: project.client_id,
    client: project.client
      ? { id: project.client.id, name: project.client.name, status: project.client.status }
      : null,
    site_id: project.site_id,
    site: project.site
      ? { id: project.site.id, name: project.site.name, url: project.site.url }
      : null,
    start_date: project.start_date,
    target_date: project.target_date,
    completed_date: project.completed_date,
    // Budget & Billing
    billing_type: project.billing_type,
    budget_hours: project.budget_hours ? Number(project.budget_hours) : null,
    hourly_rate: project.hourly_rate ? Number(project.hourly_rate) : null,
    budget_amount: project.budget_amount ? Number(project.budget_amount) : null,
    budget_locked: project.budget_locked,
    budget_locked_at: project.budget_locked_at,
    is_retainer: project.is_retainer,
    // Calculated estimates from tasks
    calculated: {
      estimated_hours_min: estimates.estimatedHoursMin,
      estimated_hours_max: estimates.estimatedHoursMax,
      estimated_range: estimates.estimatedRange,
      time_spent_minutes: estimates.timeSpentMinutes,
      task_count: estimates.taskCount,
      completed_task_count: estimates.completedTaskCount,
      total_energy_minutes: estimates.totalEnergyMinutes,
      completed_energy_minutes: estimates.completedEnergyMinutes,
      progress_percent: estimates.progressPercent,
    },
    // Legacy fields for backwards compatibility
    estimated_hours: estimates.estimatedHoursMax || null,
    completed_hours: null, // Deprecated - use calculated.time_spent_minutes
    notes: project.notes,
    created_by_id: project.created_by_id,
    created_by: project.created_by
      ? { id: project.created_by.id, name: project.created_by.name }
      : null,
    tasks_count: tasksCount,
    completed_tasks_count: estimates.completedTaskCount,
    phases: project.phases?.map(formatPhaseResponse),
    tasks: project.tasks?.map(formatTaskResponse),
    team_assignments: project.team_assignments?.map(formatTeamAssignmentResponse),
    milestones: project.milestones?.map(formatMilestoneResponse),
    health,
    is_deleted: project.is_deleted,
    created_at: project.created_at,
    updated_at: project.updated_at,
  };
}

export function formatPhaseResponse(phase: any) {
  return {
    id: phase.id,
    project_id: phase.project_id,
    name: phase.name,
    icon: phase.icon,
    sort_order: phase.sort_order,
    created_at: phase.created_at,
    updated_at: phase.updated_at,
  };
}

export function formatTeamAssignmentResponse(assignment: any) {
  return {
    id: assignment.id,
    project_id: assignment.project_id,
    user_id: assignment.user_id,
    user: assignment.user
      ? { id: assignment.user.id, name: assignment.user.name, email: assignment.user.email }
      : null,
    function_id: assignment.function_id,
    function: assignment.function
      ? { id: assignment.function.id, name: assignment.function.name }
      : null,
    is_lead: assignment.is_lead,
    created_at: assignment.created_at,
  };
}

export function formatUserFunctionResponse(userFunction: any) {
  return {
    id: userFunction.id,
    user_id: userFunction.user_id,
    function_id: userFunction.function_id,
    function: userFunction.function
      ? { id: userFunction.function.id, name: userFunction.function.name }
      : null,
    is_primary: userFunction.is_primary,
    created_at: userFunction.created_at,
  };
}

export function formatMilestoneResponse(milestone: any) {
  return {
    id: milestone.id,
    name: milestone.name,
    project_id: milestone.project_id,
    phase_id: milestone.phase_id,
    target_date: milestone.target_date,
    completed_at: milestone.completed_at,
    notes: milestone.notes,
    sort_order: milestone.sort_order,
    billing_amount: milestone.billing_amount ? Number(milestone.billing_amount) : null,
    billing_status: milestone.billing_status,
    triggered_at: milestone.triggered_at,
    triggered_by_id: milestone.triggered_by_id,
    invoiced_at: milestone.invoiced_at,
    invoiced_by_id: milestone.invoiced_by_id,
    created_at: milestone.created_at,
    updated_at: milestone.updated_at,
  };
}

// Helper to parse JSON strings (description/notes are stored as JSON strings in Text fields)
function parseJsonField(value: any): any {
  if (!value) return null;
  if (typeof value === 'object') return value; // Already parsed
  try {
    return JSON.parse(value);
  } catch {
    return value; // Return as-is if not valid JSON
  }
}

export function formatTaskResponse(task: any) {
  // Calculate time spent from time entries if available
  const timeSpentMinutes = task.time_entries
    ? task.time_entries.reduce((sum: number, entry: any) => sum + (entry.duration || 0), 0)
    : null;

  return {
    id: task.id,
    title: task.title,
    description: parseJsonField(task.description),
    status: task.status,
    priority: task.priority,
    is_focus: task.is_focus ?? false,
    project_id: task.project_id,
    client_id: task.client_id,
    client: task.client
      ? { id: task.client.id, name: task.client.name }
      : null,
    site_id: task.site_id,
    site: task.site
      ? { id: task.site.id, name: task.site.name, url: task.site.url }
      : null,
    is_maintenance_task: task.is_maintenance_task ?? false,
    maintenance_period: task.maintenance_period,
    time_spent_minutes: timeSpentMinutes,
    project: task.project
      ? {
          id: task.project.id,
          name: task.project.name,
          status: task.project.status,
          client: task.project.client
            ? { id: task.project.client.id, name: task.project.client.name }
            : null,
        }
      : null,
    phase: task.phase, // Legacy string field
    phase_id: task.phase_id,
    project_phase: task.project_phase
      ? { id: task.project_phase.id, name: task.project_phase.name, icon: task.project_phase.icon, sort_order: task.project_phase.sort_order }
      : null,
    sort_order: task.sort_order,
    assignee_id: task.assignee_id,
    assignee: task.assignee
      ? { id: task.assignee.id, name: task.assignee.name, email: task.assignee.email, avatar_url: task.assignee.avatar_url }
      : null,
    function_id: task.function_id,
    function: task.function
      ? { id: task.function.id, name: task.function.name }
      : null,
    sop_id: task.sop_id,
    sop: task.sop
      ? {
          id: task.sop.id,
          title: task.sop.title,
          estimated_minutes: task.sop.estimated_minutes,
          content: parseJsonField(task.sop.content),
        }
      : null,
    energy_estimate: task.energy_estimate,
    mystery_factor: task.mystery_factor,
    estimated_minutes: task.estimated_minutes,
    battery_impact: task.battery_impact,
    due_date: task.due_date,
    started_at: task.started_at,
    completed_at: task.completed_at,
    requirements: task.requirements,
    review_requirements: task.review_requirements, // PM/Admin-only, filtered by API
    // Review workflow
    needs_review: task.needs_review,
    reviewer_id: task.reviewer_id,
    reviewer: task.reviewer
      ? { id: task.reviewer.id, name: task.reviewer.name, email: task.reviewer.email, avatar_url: task.reviewer.avatar_url }
      : null,
    approved: task.approved,
    approved_at: task.approved_at,
    approved_by_id: task.approved_by_id,
    approved_by: task.approved_by
      ? { id: task.approved_by.id, name: task.approved_by.name }
      : null,
    notes: parseJsonField(task.notes),
    created_by_id: task.created_by_id,
    created_by: task.created_by
      ? { id: task.created_by.id, name: task.created_by.name }
      : null,
    blocked_by: task.blocked_by?.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
    })),
    blocking: task.blocking?.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
    })),
    // Billing
    is_billable: task.is_billable ?? true,
    billing_target: task.billing_target ? Number(task.billing_target) : null,
    billing_amount: task.billing_amount ? Number(task.billing_amount) : null,
    is_retainer_work: task.is_retainer_work ?? false,
    is_support: task.is_support ?? false,
    invoiced: task.invoiced ?? false,
    invoiced_at: task.invoiced_at,
    invoiced_by_id: task.invoiced_by_id,
    is_deleted: task.is_deleted,
    created_at: task.created_at,
    updated_at: task.updated_at,
  };
}
