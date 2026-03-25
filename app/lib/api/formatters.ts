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
    retainer_usage_mode: client.retainer_usage_mode,
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
      battery_impact: t.battery_impact || 'average_drain',
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
    description: parseJsonField(project.description),
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

export function formatWareResponse(ware: any) {
  return {
    id: ware.id,
    name: ware.name,
    description: ware.description,
    type: ware.type,
    charter_billing_period: ware.charter_billing_period,
    base_price: ware.base_price ? Number(ware.base_price) : null,
    price_tiers: ware.price_tiers,
    contract_language: ware.contract_language,
    default_schedule: ware.default_schedule,
    recipe_id: ware.recipe_id,
    recipe: ware.recipe
      ? { id: ware.recipe.id, name: ware.recipe.name }
      : null,
    sort_order: ware.sort_order,
    is_active: ware.is_active,
    line_items_count: (ware._count?.accord_charter_items ?? 0) + (ware._count?.accord_commission_items ?? 0),
    is_deleted: ware.is_deleted,
    created_at: ware.created_at,
    updated_at: ware.updated_at,
  };
}

function computeMrr(accord: any): number {
  let mrr = 0;

  // Charter items: monthly-normalized final_price
  if (accord.charter_items) {
    for (const item of accord.charter_items) {
      if (item.is_deleted) continue;
      const price = Number(item.final_price);
      if (item.billing_period === 'annually') {
        mrr += price / 12;
      } else {
        mrr += price;
      }
    }
  }

  // Keep items: monthly_total
  if (accord.keep_items) {
    for (const item of accord.keep_items) {
      if (item.is_deleted) continue;
      mrr += Number(item.monthly_total) || 0;
    }
  }

  return Math.round(mrr * 100) / 100;
}

function computeTotalProjectValue(accord: any): number | null {
  if (!accord.commission_items?.length) return 0;

  let total = 0;
  let hasTbd = false;

  for (const item of accord.commission_items) {
    if (item.is_deleted) continue;
    if (item.final_price === null) {
      hasTbd = true;
    } else {
      total += Number(item.final_price);
    }
  }

  // Return null if any items are TBD (caller can display "TBD")
  return hasTbd ? null : Math.round(total * 100) / 100;
}

function computeTotalContractValue(accord: any): number | null {
  let total = 0;

  // Charter total_contract_values
  if (accord.charter_items) {
    for (const item of accord.charter_items) {
      if (item.is_deleted) continue;
      total += Number(item.total_contract_value);
    }
  }

  // Keep items: monthly_total × max charter duration (or 12 months default)
  if (accord.keep_items?.length) {
    let maxDuration = 12;
    if (accord.charter_items?.length) {
      for (const item of accord.charter_items) {
        if (!item.is_deleted && item.duration_months > maxDuration) {
          maxDuration = item.duration_months;
        }
      }
    }
    for (const item of accord.keep_items) {
      if (item.is_deleted) continue;
      total += (Number(item.monthly_total) || 0) * maxDuration;
    }
  }

  // Commission totals
  const projectValue = computeTotalProjectValue(accord);
  if (projectValue === null) return null; // TBD if any commission is TBD
  total += projectValue;

  return Math.round(total * 100) / 100;
}

export function formatAccordResponse(accord: any) {
  return {
    id: accord.id,
    name: accord.name,
    status: accord.status,
    client_id: accord.client_id,
    client: accord.client
      ? { id: accord.client.id, name: accord.client.name, status: accord.client.status }
      : null,
    owner_id: accord.owner_id,
    owner: accord.owner
      ? { id: accord.owner.id, name: accord.owner.name, email: accord.owner.email, avatar_url: accord.owner.avatar_url }
      : null,
    lead_name: accord.lead_name,
    lead_business_name: accord.lead_business_name,
    lead_email: accord.lead_email,
    lead_phone: accord.lead_phone,
    lead_notes: accord.lead_notes,
    rejection_reason: accord.rejection_reason,
    payment_confirmed: accord.payment_confirmed,
    payment_confirmed_at: accord.payment_confirmed_at,
    total_value: accord.total_value ? Number(accord.total_value) : null,
    entered_current_status_at: accord.entered_current_status_at,
    lost_at: accord.lost_at,
    signed_at: accord.signed_at,
    charter_items: accord.charter_items?.map(formatAccordCharterItemResponse),
    commission_items: accord.commission_items?.map(formatAccordCommissionItemResponse),
    keep_items: accord.keep_items?.map(formatAccordKeepItemResponse),
    charter_items_count: accord._count?.charter_items ?? 0,
    commission_items_count: accord._count?.commission_items ?? 0,
    keep_items_count: accord._count?.keep_items ?? 0,
    // Computed revenue fields
    mrr: computeMrr(accord),
    total_project_value: computeTotalProjectValue(accord),
    total_contract_value: computeTotalContractValue(accord),
    is_deleted: accord.is_deleted,
    created_at: accord.created_at,
    updated_at: accord.updated_at,
  };
}

export function formatAccordCharterItemResponse(item: any) {
  return {
    id: item.id,
    accord_id: item.accord_id,
    ware_id: item.ware_id,
    ware: item.ware
      ? { id: item.ware.id, name: item.ware.name, type: item.ware.type }
      : null,
    name_override: item.name_override,
    price_tier: item.price_tier,
    base_price: Number(item.base_price),
    discount_type: item.discount_type,
    discount_value: item.discount_value ? Number(item.discount_value) : null,
    final_price: Number(item.final_price),
    billing_period: item.billing_period,
    duration_months: item.duration_months,
    total_contract_value: Number(item.total_contract_value),
    charter_id: item.charter_id,
    contract_language_override: item.contract_language_override,
    addendum_id: item.addendum_id,
    sort_order: item.sort_order,
    is_deleted: item.is_deleted,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

export function formatAccordCommissionItemResponse(item: any) {
  return {
    id: item.id,
    accord_id: item.accord_id,
    ware_id: item.ware_id,
    ware: item.ware
      ? { id: item.ware.id, name: item.ware.name, type: item.ware.type }
      : null,
    name_override: item.name_override,
    estimated_price: item.estimated_price ? Number(item.estimated_price) : null,
    project_id: item.project_id,
    project: item.project
      ? { id: item.project.id, name: item.project.name, budget_amount: item.project.budget_amount ? Number(item.project.budget_amount) : null }
      : null,
    discount_type: item.discount_type,
    discount_value: item.discount_value ? Number(item.discount_value) : null,
    final_price: item.final_price ? Number(item.final_price) : null,
    contract_language_override: item.contract_language_override,
    addendum_id: item.addendum_id,
    sort_order: item.sort_order,
    is_deleted: item.is_deleted,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

export function formatAccordKeepItemResponse(item: any) {
  return {
    id: item.id,
    accord_id: item.accord_id,
    site_id: item.site_id,
    site: item.site
      ? { id: item.site.id, name: item.site.name, url: item.site.url }
      : null,
    site_name_placeholder: item.site_name_placeholder,
    domain_name: item.domain_name,
    hosting_plan_id: item.hosting_plan_id,
    hosting_plan: item.hosting_plan
      ? { id: item.hosting_plan.id, name: item.hosting_plan.name, rate: Number(item.hosting_plan.rate) }
      : null,
    maintenance_plan_id: item.maintenance_plan_id,
    maintenance_plan: item.maintenance_plan
      ? { id: item.maintenance_plan.id, name: item.maintenance_plan.name, rate: Number(item.maintenance_plan.rate) }
      : null,
    hosting_price: item.hosting_price ? Number(item.hosting_price) : null,
    hosting_discount_type: item.hosting_discount_type,
    hosting_discount_value: item.hosting_discount_value ? Number(item.hosting_discount_value) : null,
    hosting_final_price: item.hosting_final_price ? Number(item.hosting_final_price) : null,
    maintenance_price: item.maintenance_price ? Number(item.maintenance_price) : null,
    maintenance_discount_type: item.maintenance_discount_type,
    maintenance_discount_value: item.maintenance_discount_value ? Number(item.maintenance_discount_value) : null,
    maintenance_final_price: item.maintenance_final_price ? Number(item.maintenance_final_price) : null,
    monthly_total: item.monthly_total ? Number(item.monthly_total) : null,
    is_client_hosted: item.is_client_hosted,
    contract_language_override: item.contract_language_override,
    addendum_id: item.addendum_id,
    sort_order: item.sort_order,
    is_deleted: item.is_deleted,
    created_at: item.created_at,
    updated_at: item.updated_at,
  };
}

// Meeting formatters
export function formatMeetingResponse(meeting: any) {
  return {
    id: meeting.id,
    title: meeting.title,
    client_id: meeting.client_id,
    client: meeting.client
      ? { id: meeting.client.id, name: meeting.client.name, status: meeting.client.status }
      : null,
    meeting_date: meeting.meeting_date,
    summary: meeting.summary,
    notes: meeting.notes,
    transcript_url: meeting.transcript_url,
    recording_url: meeting.recording_url,
    client_attendees: meeting.client_attendees,
    transcript_not_available: meeting.transcript_not_available,
    recording_not_available: meeting.recording_not_available,
    created_by_id: meeting.created_by_id,
    created_by: meeting.created_by
      ? { id: meeting.created_by.id, name: meeting.created_by.name, email: meeting.created_by.email, avatar_url: meeting.created_by.avatar_url }
      : null,
    attendees: meeting.attendees?.map(formatMeetingAttendeeResponse),
    meeting_accords: meeting.meeting_accords?.map(formatMeetingAccordResponse),
    meeting_projects: meeting.meeting_projects?.map(formatMeetingProjectResponse),
    meeting_charters: meeting.meeting_charters?.map(formatMeetingCharterResponse),
    tasks_count: meeting._count?.tasks ?? meeting.tasks?.length ?? 0,
    is_deleted: meeting.is_deleted,
    created_at: meeting.created_at,
    updated_at: meeting.updated_at,
  };
}

export function formatMeetingAttendeeResponse(attendee: any) {
  return {
    id: attendee.id,
    meeting_id: attendee.meeting_id,
    user_id: attendee.user_id,
    user: attendee.user
      ? { id: attendee.user.id, name: attendee.user.name, email: attendee.user.email }
      : null,
    created_at: attendee.created_at,
  };
}

export function formatMeetingAccordResponse(ma: any) {
  return {
    id: ma.id,
    meeting_id: ma.meeting_id,
    accord_id: ma.accord_id,
    accord: ma.accord
      ? { id: ma.accord.id, name: ma.accord.name, status: ma.accord.status }
      : null,
    created_at: ma.created_at,
  };
}

export function formatMeetingProjectResponse(mp: any) {
  return {
    id: mp.id,
    meeting_id: mp.meeting_id,
    project_id: mp.project_id,
    project: mp.project
      ? { id: mp.project.id, name: mp.project.name }
      : null,
    created_at: mp.created_at,
  };
}

export function formatMeetingCharterResponse(mc: any) {
  return {
    id: mc.id,
    meeting_id: mc.meeting_id,
    charter_id: mc.charter_id,
    charter: mc.charter
      ? { id: mc.charter.id, name: mc.charter.name }
      : null,
    created_at: mc.created_at,
  };
}

export function formatProposalResponse(proposal: any) {
  return {
    id: proposal.id,
    accord_id: proposal.accord_id,
    accord: proposal.accord
      ? { id: proposal.accord.id, name: proposal.accord.name, status: proposal.accord.status }
      : null,
    version: proposal.version,
    content: proposal.content,
    status: proposal.status,
    pricing_snapshot: proposal.pricing_snapshot,
    sent_at: proposal.sent_at,
    client_responded_at: proposal.client_responded_at,
    client_note: proposal.client_note,
    portal_token: proposal.portal_token,
    portal_token_expires_at: proposal.portal_token_expires_at,
    created_by_id: proposal.created_by_id,
    created_by: proposal.created_by
      ? { id: proposal.created_by.id, name: proposal.created_by.name, email: proposal.created_by.email }
      : null,
    is_deleted: proposal.is_deleted,
    created_at: proposal.created_at,
    updated_at: proposal.updated_at,
  };
}

export function formatMsaVersionResponse(msaVersion: any) {
  return {
    id: msaVersion.id,
    version: msaVersion.version,
    content: msaVersion.content,
    effective_date: msaVersion.effective_date,
    is_current: msaVersion.is_current,
    change_summary: msaVersion.change_summary,
    created_by_id: msaVersion.created_by_id,
    created_by: msaVersion.created_by
      ? { id: msaVersion.created_by.id, name: msaVersion.created_by.name, email: msaVersion.created_by.email }
      : null,
    signatures_count: msaVersion._count?.client_msa_signatures ?? 0,
    created_at: msaVersion.created_at,
    updated_at: msaVersion.updated_at,
  };
}

export function formatClientMsaSignatureResponse(signature: any) {
  return {
    id: signature.id,
    client_id: signature.client_id,
    client: signature.client
      ? { id: signature.client.id, name: signature.client.name }
      : null,
    msa_version_id: signature.msa_version_id,
    msa_version: signature.msa_version
      ? { id: signature.msa_version.id, version: signature.msa_version.version }
      : null,
    signed_at: signature.signed_at,
    signer_name: signature.signer_name,
    signer_email: signature.signer_email,
    signer_ip: signature.signer_ip,
    signer_user_agent: signature.signer_user_agent,
    created_at: signature.created_at,
  };
}

export function formatContractResponse(contract: any) {
  return {
    id: contract.id,
    accord_id: contract.accord_id,
    accord: contract.accord
      ? { id: contract.accord.id, name: contract.accord.name, status: contract.accord.status }
      : null,
    version: contract.version,
    content: contract.content,
    msa_version_id: contract.msa_version_id,
    msa_version: contract.msa_version
      ? { id: contract.msa_version.id, version: contract.msa_version.version }
      : null,
    status: contract.status,
    pricing_snapshot: contract.pricing_snapshot,
    sent_at: contract.sent_at,
    signed_at: contract.signed_at,
    signer_name: contract.signer_name,
    signer_email: contract.signer_email,
    content_snapshot: contract.content_snapshot,
    portal_token: contract.portal_token,
    portal_token_expires_at: contract.portal_token_expires_at,
    created_by_id: contract.created_by_id,
    created_by: contract.created_by
      ? { id: contract.created_by.id, name: contract.created_by.name, email: contract.created_by.email }
      : null,
    is_deleted: contract.is_deleted,
    created_at: contract.created_at,
    updated_at: contract.updated_at,
  };
}

export function formatCharterResponse(charter: any) {
  return {
    id: charter.id,
    name: charter.name,
    status: charter.status,
    client_id: charter.client_id,
    client: charter.client
      ? { id: charter.client.id, name: charter.client.name, status: charter.client.status }
      : null,
    accord_id: charter.accord_id,
    accord: charter.accord
      ? { id: charter.accord.id, name: charter.accord.name, status: charter.accord.status }
      : null,
    billing_period: charter.billing_period,
    budget_hours: charter.budget_hours ? Number(charter.budget_hours) : null,
    hourly_rate: charter.hourly_rate ? Number(charter.hourly_rate) : null,
    budget_amount: charter.budget_amount ? Number(charter.budget_amount) : null,
    start_date: charter.start_date,
    end_date: charter.end_date,
    paused_at: charter.paused_at,
    cancelled_at: charter.cancelled_at,
    cancellation_reason: charter.cancellation_reason,
    created_by_id: charter.created_by_id,
    created_by: charter.created_by
      ? { id: charter.created_by.id, name: charter.created_by.name }
      : null,
    charter_wares: charter.charter_wares?.map(formatCharterWareResponse),
    scheduled_tasks: charter.scheduled_tasks?.map(formatCharterScheduledTaskResponse),
    charter_commissions: charter.charter_commissions?.map(formatCharterCommissionResponse),
    tasks_count: charter._count?.tasks ?? 0,
    is_deleted: charter.is_deleted,
    created_at: charter.created_at,
    updated_at: charter.updated_at,
  };
}

export function formatCharterWareResponse(cw: any) {
  return {
    id: cw.id,
    charter_id: cw.charter_id,
    ware_id: cw.ware_id,
    ware: cw.ware
      ? { id: cw.ware.id, name: cw.ware.name, type: cw.ware.type }
      : null,
    price: Number(cw.price),
    is_active: cw.is_active,
    deactivated_at: cw.deactivated_at,
    addendum_id: cw.addendum_id,
    scheduled_tasks: cw.scheduled_tasks?.map(formatCharterScheduledTaskResponse),
    created_at: cw.created_at,
    updated_at: cw.updated_at,
  };
}

export function formatCharterScheduledTaskResponse(st: any) {
  return {
    id: st.id,
    charter_id: st.charter_id,
    charter_ware_id: st.charter_ware_id,
    sop_id: st.sop_id,
    sop: st.sop
      ? { id: st.sop.id, title: st.sop.title }
      : null,
    cadence: st.cadence,
    sort_order: st.sort_order,
    is_active: st.is_active,
    created_at: st.created_at,
    updated_at: st.updated_at,
  };
}

export function formatCharterCommissionResponse(cc: any) {
  return {
    id: cc.id,
    charter_id: cc.charter_id,
    commission_id: cc.commission_id,
    commission: cc.commission
      ? { id: cc.commission.id, name: cc.commission.name, status: cc.commission.status }
      : null,
    allocated_hours_per_period: cc.allocated_hours_per_period ? Number(cc.allocated_hours_per_period) : null,
    start_period: cc.start_period,
    end_period: cc.end_period,
    is_active: cc.is_active,
    completed_at: cc.completed_at,
    created_at: cc.created_at,
    updated_at: cc.updated_at,
  };
}

export function formatAddendumResponse(addendum: any) {
  return {
    id: addendum.id,
    accord_id: addendum.accord_id,
    accord: addendum.accord
      ? { id: addendum.accord.id, name: addendum.accord.name, status: addendum.accord.status }
      : null,
    version: addendum.version,
    title: addendum.title,
    description: addendum.description,
    contract_content: addendum.contract_content,
    status: addendum.status,
    pricing_snapshot: addendum.pricing_snapshot,
    changes: addendum.changes,
    sent_at: addendum.sent_at,
    client_responded_at: addendum.client_responded_at,
    client_note: addendum.client_note,
    signed_at: addendum.signed_at,
    signer_name: addendum.signer_name,
    signer_email: addendum.signer_email,
    content_snapshot: addendum.content_snapshot,
    portal_token: addendum.portal_token,
    portal_token_expires_at: addendum.portal_token_expires_at,
    is_override: addendum.is_override,
    override_reason: addendum.override_reason,
    overridden_by_id: addendum.overridden_by_id,
    overridden_by: addendum.overridden_by
      ? { id: addendum.overridden_by.id, name: addendum.overridden_by.name }
      : null,
    created_by_id: addendum.created_by_id,
    created_by: addendum.created_by
      ? { id: addendum.created_by.id, name: addendum.created_by.name, email: addendum.created_by.email }
      : null,
    charter_items: addendum.charter_items?.map(formatAccordCharterItemResponse),
    commission_items: addendum.commission_items?.map(formatAccordCommissionItemResponse),
    keep_items: addendum.keep_items?.map(formatAccordKeepItemResponse),
    is_deleted: addendum.is_deleted,
    created_at: addendum.created_at,
    updated_at: addendum.updated_at,
  };
}

export function formatAutomationRuleResponse(rule: any) {
  return {
    id: rule.id,
    name: rule.name,
    trigger_type: rule.trigger_type,
    trigger_status: rule.trigger_status,
    trigger_from_status: rule.trigger_from_status,
    time_threshold_hours: rule.time_threshold_hours,
    action_type: rule.action_type,
    task_template: rule.task_template,
    assignee_rule: rule.assignee_rule,
    assignee_user_id: rule.assignee_user_id,
    assignee_user: rule.assignee_user
      ? { id: rule.assignee_user.id, name: rule.assignee_user.name, email: rule.assignee_user.email }
      : null,
    is_active: rule.is_active,
    sort_order: rule.sort_order,
    created_at: rule.created_at,
    updated_at: rule.updated_at,
  };
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
      assignee_id: t.assignee_id,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      project: t.project ? { id: t.project.id, name: t.project.name, status: t.project.status } : null,
    })),
    blocking: task.blocking?.map((t: any) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      assignee_id: t.assignee_id,
      assignee: t.assignee ? { id: t.assignee.id, name: t.assignee.name } : null,
      project: t.project ? { id: t.project.id, name: t.project.name, status: t.project.status } : null,
    })),
    time_entries: task.time_entries?.map((e: any) => ({
      id: e.id,
      duration: e.duration,
      started_at: e.started_at,
      description: e.description,
      user: e.user ? { id: e.user.id, name: e.user.name } : null,
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
