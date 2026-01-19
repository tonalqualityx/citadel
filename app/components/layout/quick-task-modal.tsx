'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, AlertCircle } from 'lucide-react';
import { useCreateTask } from '@/lib/hooks/use-tasks';
import { useProjects } from '@/lib/hooks/use-projects';
import { useClients, useClientRetainer } from '@/lib/hooks/use-clients';
import { useSites } from '@/lib/hooks/use-sites';
import { useSops } from '@/lib/hooks/use-sops';
import { useUsers } from '@/lib/hooks/use-users';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
import { addBusinessDays, formatDateForInput } from '@/lib/utils/time';
import { energyToMinutes, getMysteryMultiplier } from '@/lib/calculations/energy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Spinner } from '@/components/ui/spinner';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import {
  PriorityFormSelect,
  EnergyFormSelect,
  MysteryFormSelect,
  BatteryFormSelect,
} from '@/components/ui/field-selects';

const quickTaskSchema = z.object({
  title: z.string().min(1, 'Title is required').max(500),
  project_id: z.string().optional(),
  client_id: z.string().optional(),
  site_id: z.string().optional(),
  task_type: z.enum(['ad_hoc', 'support']).optional(),
  sop_id: z.string().optional(),
  assignee_id: z.string().optional(),
  priority: z.string(),
  energy_estimate: z.string().optional(),
  mystery_factor: z.enum(['none', 'average', 'significant', 'no_idea']),
  battery_impact: z.enum(['average_drain', 'high_drain', 'energizing']),
  billing_amount: z.string().optional(),
  due_date: z.string().optional(),
}).refine(
  (data) => !data.site_id || data.task_type,
  { message: 'Task type is required when a site is selected', path: ['task_type'] }
);

type QuickTaskFormData = z.infer<typeof quickTaskSchema>;

export function QuickTaskModal() {
  const router = useRouter();
  const { t } = useTerminology();
  const { user } = useAuth();
  const isPmOrAdmin = user?.role === 'pm' || user?.role === 'admin';
  const [open, setOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const createTask = useCreateTask();
  const { data: projectsData, isLoading: projectsLoading } = useProjects({ limit: 100 });
  const { data: clientsData, isLoading: clientsLoading } = useClients({ limit: 100, status: 'active' });
  const { data: sopsData, isLoading: sopsLoading } = useSops({ limit: 100 });
  const { data: usersData, isLoading: usersLoading } = useUsers();

  // Track if SOP defaults have been applied to avoid overwriting user changes
  const [sopApplied, setSopApplied] = React.useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<QuickTaskFormData>({
    resolver: zodResolver(quickTaskSchema),
    defaultValues: {
      title: '',
      project_id: '',
      client_id: '',
      site_id: '',
      task_type: undefined,
      sop_id: '',
      assignee_id: '',
      priority: '3',
      energy_estimate: '1', // 15 minutes
      mystery_factor: 'average', // "Some"
      battery_impact: 'average_drain',
      billing_amount: '',
      due_date: formatDateForInput(addBusinessDays(new Date(), 4)),
    },
  });

  // Watch for client selection to filter projects and sites
  const selectedClientId = watch('client_id');
  const selectedSopId = watch('sop_id');
  const selectedProjectId = watch('project_id');
  const selectedSiteId = watch('site_id');
  const dueDate = watch('due_date');
  const energyEstimate = watch('energy_estimate');
  const mysteryFactor = watch('mystery_factor');
  const billingAmount = watch('billing_amount');
  const taskType = watch('task_type');

  // Fetch sites filtered by client
  const { data: sitesData, isLoading: sitesLoading } = useSites({
    client_id: selectedClientId || undefined,
    limit: 100,
  });

  // Filter projects by client if one is selected, and exclude inactive statuses
  const projectOptions = React.useMemo(() => {
    let projects = projectsData?.projects || [];

    // Exclude done, suspended, and cancelled projects
    const excludedStatuses = ['done', 'suspended', 'cancelled'];
    projects = projects.filter((p) => !excludedStatuses.includes(p.status));

    // If a client is selected, filter to only that client's projects
    if (selectedClientId) {
      projects = projects.filter((p) => p.client?.id === selectedClientId);
    }

    return [
      { value: '', label: 'No project (ad-hoc)' },
      ...projects.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.client?.name || 'No client'})`,
      })),
    ];
  }, [projectsData, selectedClientId]);

  // Determine the effective client ID (from project or direct selection)
  const effectiveClientId = React.useMemo(() => {
    if (selectedProjectId) {
      const project = projectsData?.projects?.find(p => p.id === selectedProjectId);
      return project?.client?.id || null;
    }
    return selectedClientId || null;
  }, [selectedProjectId, selectedClientId, projectsData]);

  // Get the client data to check for retainer
  const effectiveClient = React.useMemo(() => {
    if (!effectiveClientId) return null;
    return clientsData?.clients?.find(c => c.id === effectiveClientId) || null;
  }, [effectiveClientId, clientsData]);

  // Calculate which month to check based on due date
  const targetMonth = React.useMemo(() => {
    if (!dueDate) {
      // No due date - use current month
      const now = new Date();
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }

    // Parse due date and get its month
    const date = new Date(dueDate);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }, [dueDate]);

  // Fetch retainer usage for the target month
  const { data: retainerData } = useClientRetainer(
    effectiveClientId || undefined,
    targetMonth
  );

  // Calculate retainer warning
  const retainerWarning = React.useMemo(() => {
    // Only show warning if:
    // 1. Client has retainer hours
    // 2. We have retainer data for the month
    // 3. We have energy estimate to calculate cost
    // 4. No fixed billing amount (fixed amounts don't consume retainer hours)
    // 5. Not a support task (support tasks don't consume retainer)

    if (!effectiveClient?.retainer_hours) return null;
    if (!retainerData) return null;
    if (!energyEstimate) return null;

    // Show info message for support tasks
    if (taskType === 'support') {
      return {
        status: 'info' as const,
        title: 'Support Task',
        message: 'This task is marked as support and will not consume retainer hours or be billed.',
      };
    }

    if (billingAmount) return null; // Fixed billing doesn't use retainer hours

    const retainerHours = Number(effectiveClient.retainer_hours);
    const retainerMinutes = retainerHours * 60;

    // Calculate estimated minutes for this task
    const baseMinutes = energyToMinutes(parseInt(energyEstimate));
    const multiplier = getMysteryMultiplier(mysteryFactor);
    const estimatedMinutes = Math.round(baseMinutes * multiplier);
    const estimatedHours = estimatedMinutes / 60;

    // Current usage from API (actual + scheduled)
    const currentUsedMinutes = retainerData.usedMinutes || 0;
    const currentScheduledMinutes = retainerData.scheduledMinutes || 0;
    const currentTotalMinutes = currentUsedMinutes + currentScheduledMinutes;

    // Projected usage after adding this task
    const projectedTotalMinutes = currentTotalMinutes + estimatedMinutes;
    const projectedHours = projectedTotalMinutes / 60;
    const projectedPercent = Math.round((projectedTotalMinutes / retainerMinutes) * 100);

    // No warning if below 75% threshold
    if (projectedPercent < 75) return null;

    // Critical warning if at or over 100%
    if (projectedPercent >= 100) {
      const overageHours = (projectedTotalMinutes - retainerMinutes) / 60;
      return {
        status: 'critical',
        title: 'Retainer Exceeded',
        message: `This task will exceed the ${retainerHours}h retainer by ${overageHours.toFixed(1)}h (${projectedPercent}% total). Overage will be billed at hourly rate.`,
      };
    }

    // Warning if 75-99%
    return {
      status: 'warning',
      title: 'Approaching Retainer Limit',
      message: `This task will use ${estimatedHours.toFixed(1)}h, bringing total to ${projectedHours.toFixed(1)}h of ${retainerHours}h (${projectedPercent}%).`,
    };
  }, [
    effectiveClient,
    retainerData,
    energyEstimate,
    mysteryFactor,
    billingAmount,
    taskType,
  ]);

  // Apply SOP defaults when SOP is selected
  React.useEffect(() => {
    if (selectedSopId && selectedSopId !== sopApplied && sopsData?.sops) {
      const selectedSop = sopsData.sops.find((s) => s.id === selectedSopId);
      if (selectedSop) {
        // Apply SOP defaults to estimate fields
        if (selectedSop.default_priority) {
          setValue('priority', selectedSop.default_priority.toString());
        }
        if (selectedSop.energy_estimate) {
          setValue('energy_estimate', selectedSop.energy_estimate.toString());
        }
        if (selectedSop.mystery_factor) {
          setValue('mystery_factor', selectedSop.mystery_factor as any);
        }
        if (selectedSop.battery_impact) {
          setValue('battery_impact', selectedSop.battery_impact as any);
        }
        setSopApplied(selectedSopId);
      }
    } else if (!selectedSopId && sopApplied) {
      // Reset the tracking when SOP is cleared
      setSopApplied(null);
    }
  }, [selectedSopId, sopsData, sopApplied, setValue]);

  // When project is selected, clear client_id (project includes client)
  React.useEffect(() => {
    if (selectedProjectId) {
      setValue('client_id', '');
      setValue('site_id', '');
      setValue('task_type', undefined);
    }
  }, [selectedProjectId, setValue]);

  // When client changes, clear site_id and task_type
  React.useEffect(() => {
    setValue('site_id', '');
    setValue('task_type', undefined);
  }, [selectedClientId, setValue]);

  // When site is cleared, clear task_type
  React.useEffect(() => {
    if (!selectedSiteId) {
      setValue('task_type', undefined);
    }
  }, [selectedSiteId, setValue]);

  const clientOptions = React.useMemo(() => {
    return [
      { value: '', label: 'No client (internal)' },
      ...(clientsData?.clients.map((c) => ({
        value: c.id,
        label: c.name,
      })) || []),
    ];
  }, [clientsData]);

  const siteOptions = React.useMemo(() => {
    return [
      { value: '', label: 'No site' },
      ...(sitesData?.sites?.map((s) => ({
        value: s.id,
        label: s.name,
        description: s.url || undefined,
      })) || []),
    ];
  }, [sitesData]);

  const taskTypeOptions = [
    { value: 'ad_hoc', label: 'Ad-hoc Request' },
    { value: 'support', label: 'Support (unbilled)' },
  ];

  const sopOptions = React.useMemo(() => {
    return [
      { value: '', label: 'No Rune' },
      ...(sopsData?.sops?.map((s) => ({
        value: s.id,
        label: s.title,
        description: s.function?.name,
      })) || []),
    ];
  }, [sopsData]);

  const userOptions = React.useMemo(() => {
    return [
      { value: '', label: 'Unassigned' },
      ...(usersData?.users?.map((u) => ({
        value: u.id,
        label: u.name,
        description: u.email,
      })) || []),
    ];
  }, [usersData]);

  const handleCreate = async (data: QuickTaskFormData, openAfter: boolean) => {
    setIsSubmitting(true);
    try {
      const payload = {
        title: data.title,
        priority: parseInt(data.priority),
        project_id: data.project_id || null,
        client_id: !data.project_id && data.client_id ? data.client_id : null,
        site_id: data.site_id || null,
        sop_id: data.sop_id || null,
        assignee_id: data.assignee_id || null,
        energy_estimate: data.energy_estimate ? parseInt(data.energy_estimate) : null,
        mystery_factor: data.mystery_factor,
        battery_impact: data.battery_impact,
        status: 'not_started' as const,
        is_support: data.task_type === 'support',
        billing_amount: data.billing_amount ? parseFloat(data.billing_amount) : null,
        due_date: data.due_date ? new Date(data.due_date).toISOString() : null,
      };

      const task = await createTask.mutateAsync(payload);
      reset();
      setSopApplied(null);
      setOpen(false);

      if (openAfter && task?.id) {
        router.push(`/tasks/${task.id}`);
      }
    } catch (error) {
      console.error('Failed to create task:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onSubmitCreate = handleSubmit((data) => handleCreate(data, false));
  const onSubmitCreateAndOpen = handleSubmit((data) => handleCreate(data, true));

  return (
    <Modal open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5"
      >
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">{t('newTask')}</span>
      </Button>

      <ModalContent size="xl">
        <ModalHeader>
          <ModalTitle>Quick Create {t('task')}</ModalTitle>
        </ModalHeader>

        <ModalBody>
          <form className="space-y-6">
            {/* Section 1: Basic Info */}
            <div>
              <h4 className="text-sm font-medium text-text-sub mb-3">Basic Info</h4>
              <Input
                label="Title"
                {...register('title')}
                error={errors.title?.message}
                placeholder={`${t('task')} title`}
                autoFocus
              />
            </div>

            {/* Section 2: Assignment */}
            <div className="pt-4 border-t border-border">
              <h4 className="text-sm font-medium text-text-sub mb-3">Assignment</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Client first - selecting filters available projects and sites */}
                {!selectedProjectId && (
                  clientsLoading ? (
                    <div className="h-10 flex items-center">
                      <Spinner size="sm" />
                    </div>
                  ) : (
                    <Combobox
                      label="Client"
                      options={clientOptions}
                      value={watch('client_id') || null}
                      onChange={(value) => setValue('client_id', value || '')}
                      placeholder="No client (internal)"
                      searchPlaceholder="Search clients..."
                    />
                  )
                )}

                {/* Site - only show when client is selected and no project */}
                {selectedClientId && !selectedProjectId && (
                  sitesLoading ? (
                    <div className="h-10 flex items-center">
                      <Spinner size="sm" />
                    </div>
                  ) : (
                    <Combobox
                      label="Site"
                      options={siteOptions}
                      value={watch('site_id') || null}
                      onChange={(value) => setValue('site_id', value || '')}
                      placeholder="No site"
                      searchPlaceholder="Search sites..."
                    />
                  )
                )}

                {/* Task Type - required when site is selected */}
                {selectedSiteId && (
                  <div>
                    <Combobox
                      label="Task Type"
                      options={taskTypeOptions}
                      value={watch('task_type') || null}
                      onChange={(value) => setValue('task_type', value as 'ad_hoc' | 'support' | undefined)}
                      placeholder="Select type..."
                    />
                    {errors.task_type?.message && (
                      <p className="text-sm text-red-500 mt-1">{errors.task_type.message}</p>
                    )}
                  </div>
                )}

                {/* Project - filtered by client if selected */}
                {projectsLoading ? (
                  <div className="h-10 flex items-center">
                    <Spinner size="sm" />
                  </div>
                ) : (
                  <Combobox
                    label={selectedClientId ? `${t('project')} (filtered by ${t('client').toLowerCase()})` : t('project')}
                    options={projectOptions}
                    value={watch('project_id') || null}
                    onChange={(value) => setValue('project_id', value || '')}
                    placeholder="No project (ad-hoc)"
                    searchPlaceholder="Search pacts..."
                  />
                )}

                {usersLoading ? (
                  <div className="h-10 flex items-center">
                    <Spinner size="sm" />
                  </div>
                ) : (
                  <Combobox
                    label="Assignee"
                    options={userOptions}
                    value={watch('assignee_id') || null}
                    onChange={(value) => setValue('assignee_id', value || '')}
                    placeholder="Unassigned"
                    searchPlaceholder="Search team members..."
                  />
                )}

                {sopsLoading ? (
                  <div className="h-10 flex items-center">
                    <Spinner size="sm" />
                  </div>
                ) : (
                  <Combobox
                    label="Rune"
                    options={sopOptions}
                    value={watch('sop_id') || null}
                    onChange={(value) => setValue('sop_id', value || '')}
                    placeholder="No Rune"
                    searchPlaceholder="Search runes..."
                  />
                )}
              </div>
            </div>

            {/* Section 3: Estimates */}
            <div className="pt-4 border-t border-border">
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-medium text-text-sub">Estimates</h4>
                {sopApplied && (
                  <span className="text-xs text-primary">Defaults from Rune applied</span>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <PriorityFormSelect
                  label="Priority"
                  value={watch('priority')}
                  onChange={(value) => setValue('priority', value)}
                />
                <EnergyFormSelect
                  label="Energy"
                  value={watch('energy_estimate') || ''}
                  onChange={(value) => setValue('energy_estimate', value)}
                />
                <MysteryFormSelect
                  label="Mystery"
                  value={watch('mystery_factor')}
                  onChange={(value) => setValue('mystery_factor', value as any)}
                />
                <BatteryFormSelect
                  label="Battery"
                  value={watch('battery_impact')}
                  onChange={(value) => setValue('battery_impact', value as any)}
                />
              </div>
            </div>

            {/* Retainer Warning - shown when client has retainer and task would impact it */}
            {retainerWarning && (
              <div className="pt-4 border-t border-border">
                <div className={`rounded-lg p-3 ${
                  retainerWarning.status === 'critical'
                    ? 'bg-red-50 border border-red-200'
                    : retainerWarning.status === 'info'
                    ? 'bg-blue-50 border border-blue-200'
                    : 'bg-amber-50 border border-amber-200'
                }`}>
                  <div className="flex items-start gap-2">
                    <AlertCircle className={`h-5 w-5 mt-0.5 ${
                      retainerWarning.status === 'critical'
                        ? 'text-red-600'
                        : retainerWarning.status === 'info'
                        ? 'text-blue-600'
                        : 'text-amber-600'
                    }`} />
                    <div className="flex-1">
                      <p className={`text-sm font-medium ${
                        retainerWarning.status === 'critical'
                          ? 'text-red-900'
                          : retainerWarning.status === 'info'
                          ? 'text-blue-900'
                          : 'text-amber-900'
                      }`}>
                        {retainerWarning.title}
                      </p>
                      <p className={`text-xs mt-1 ${
                        retainerWarning.status === 'critical'
                          ? 'text-red-700'
                          : retainerWarning.status === 'info'
                          ? 'text-blue-700'
                          : 'text-amber-700'
                      }`}>
                        {retainerWarning.message}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Section 4: Scheduling & Billing */}
            <div className="pt-4 border-t border-border">
              <h4 className="text-sm font-medium text-text-sub mb-3">Scheduling & Billing</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Input
                    label="Due Date"
                    type="date"
                    {...register('due_date')}
                    error={errors.due_date?.message}
                  />
                  <p className="text-xs text-text-sub mt-1">Default: 4 business days</p>
                </div>

                {isPmOrAdmin && (
                  <div>
                    <Input
                      label="Fixed Billing ($)"
                      type="number"
                      min={0}
                      step={0.01}
                      {...register('billing_amount')}
                      placeholder="Use hourly rate"
                    />
                    <p className="text-xs text-text-sub mt-1">Overrides hourly calc</p>
                  </div>
                )}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex justify-end gap-3 pt-4 border-t border-border">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={onSubmitCreate}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Spinner size="sm" className="mr-2" /> : null}
                Create
              </Button>
              <Button
                type="button"
                onClick={onSubmitCreateAndOpen}
                disabled={isSubmitting}
              >
                {isSubmitting ? <Spinner size="sm" className="mr-2" /> : null}
                Create & Open
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
