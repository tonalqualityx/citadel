'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus } from 'lucide-react';
import { useCreateTask } from '@/lib/hooks/use-tasks';
import { useProjects } from '@/lib/hooks/use-projects';
import { useClients } from '@/lib/hooks/use-clients';
import { useSites } from '@/lib/hooks/use-sites';
import { useSops } from '@/lib/hooks/use-sops';
import { useUsers } from '@/lib/hooks/use-users';
import { useTerminology } from '@/lib/hooks/use-terminology';
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
}).refine(
  (data) => !data.site_id || data.task_type,
  { message: 'Task type is required when a site is selected', path: ['task_type'] }
);

type QuickTaskFormData = z.infer<typeof quickTaskSchema>;

export function QuickTaskModal() {
  const router = useRouter();
  const { t } = useTerminology();
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
      energy_estimate: '',
      mystery_factor: 'none',
      battery_impact: 'average_drain',
    },
  });

  // Watch for client selection to filter projects and sites
  const selectedClientId = watch('client_id');
  const selectedSopId = watch('sop_id');
  const selectedProjectId = watch('project_id');
  const selectedSiteId = watch('site_id');

  // Fetch sites filtered by client
  const { data: sitesData, isLoading: sitesLoading } = useSites({
    client_id: selectedClientId || undefined,
    limit: 100,
  });

  // Filter projects by client if one is selected
  const projectOptions = React.useMemo(() => {
    let projects = projectsData?.projects || [];

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
