'use client';

import * as React from 'react';
import { useProjects, useProject } from '@/lib/hooks/use-projects';
import { useUsers } from '@/lib/hooks/use-users';
import {
  useBugReportSettings,
  useUpdateBugReportSettings,
} from '@/lib/hooks/use-bug-report-settings';
import { showToast } from '@/lib/hooks/use-toast';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Badge } from '@/components/ui/badge';

export default function AdminSettingsPage() {
  const { data: settings, isLoading: settingsLoading } = useBugReportSettings();
  const updateSettings = useUpdateBugReportSettings();

  // Local state for form
  const [projectId, setProjectId] = React.useState<string | null>(null);
  const [phaseId, setPhaseId] = React.useState<string | null>(null);
  const [notifyUserId, setNotifyUserId] = React.useState<string | null>(null);
  const [hasChanges, setHasChanges] = React.useState(false);

  // Fetch data
  const { data: projectsData, isLoading: projectsLoading } = useProjects({ limit: 100 });
  const { data: selectedProject, isLoading: projectLoading } = useProject(projectId || '');
  const { data: usersData, isLoading: usersLoading } = useUsers();

  // Initialize form from settings
  React.useEffect(() => {
    if (settings) {
      setProjectId(settings.bug_report_project_id);
      setPhaseId(settings.bug_report_phase_id);
      setNotifyUserId(settings.bug_report_notify_user_id);
    }
  }, [settings]);

  // Clear phase when project changes
  React.useEffect(() => {
    if (projectId !== settings?.bug_report_project_id) {
      setPhaseId(null);
      setHasChanges(true);
    }
  }, [projectId, settings?.bug_report_project_id]);

  // Track changes
  React.useEffect(() => {
    if (!settings) return;
    const changed =
      projectId !== settings.bug_report_project_id ||
      phaseId !== settings.bug_report_phase_id ||
      notifyUserId !== settings.bug_report_notify_user_id;
    setHasChanges(changed);
  }, [projectId, phaseId, notifyUserId, settings]);

  // Build options
  const projectOptions = React.useMemo(() => {
    return [
      { value: '', label: 'None (disabled)' },
      ...(projectsData?.projects?.map((p) => ({
        value: p.id,
        label: p.name,
        description: p.client?.name,
      })) || []),
    ];
  }, [projectsData]);

  const phaseOptions = React.useMemo(() => {
    if (!selectedProject?.phases) {
      return [{ value: '', label: 'Select a project first' }];
    }
    return [
      { value: '', label: 'None' },
      ...selectedProject.phases.map((phase) => ({
        value: phase.id,
        label: phase.name,
      })),
    ];
  }, [selectedProject]);

  const userOptions = React.useMemo(() => {
    return [
      { value: '', label: 'None (no notifications)' },
      ...(usersData?.users
        ?.filter((u) => u.role === 'admin' || u.role === 'pm')
        .map((u) => ({
          value: u.id,
          label: u.name,
          description: u.email,
        })) || []),
    ];
  }, [usersData]);

  const handleSave = async () => {
    try {
      await updateSettings.mutateAsync({
        bug_report_project_id: projectId || null,
        bug_report_phase_id: phaseId || null,
        bug_report_notify_user_id: notifyUserId || null,
      });
      showToast.success('Settings saved');
      setHasChanges(false);
    } catch (error) {
      // Error is handled by the mutation
    }
  };

  const isConfigured = projectId && phaseId;

  if (settingsLoading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-text-main">Settings</h1>
        <p className="text-text-sub">Configure application-wide settings</p>
      </div>

      {/* Bug Reporting Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Bug Reporting</CardTitle>
            {isConfigured ? (
              <Badge variant="success">Configured</Badge>
            ) : (
              <Badge variant="default">Not configured</Badge>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-text-sub">
            Configure where bug reports are sent. When configured, a "Report Bug" button
            will appear in the header for all users.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Project Selection */}
            <div>
              {projectsLoading ? (
                <div className="h-10 flex items-center">
                  <Spinner size="sm" />
                </div>
              ) : (
                <Combobox
                  label="Bug Report Project"
                  options={projectOptions}
                  value={projectId}
                  onChange={(value) => setProjectId(value || null)}
                  placeholder="Select a project..."
                  searchPlaceholder="Search projects..."
                />
              )}
              <p className="text-xs text-text-sub mt-1">
                Bug reports will be created as tasks in this project
              </p>
            </div>

            {/* Phase Selection */}
            <div>
              {projectLoading ? (
                <div className="h-10 flex items-center">
                  <Spinner size="sm" />
                </div>
              ) : (
                <Combobox
                  label="Bug Report Phase"
                  options={phaseOptions}
                  value={phaseId}
                  onChange={(value) => {
                    setPhaseId(value || null);
                    setHasChanges(true);
                  }}
                  placeholder={projectId ? 'Select a phase...' : 'Select a project first'}
                  searchPlaceholder="Search phases..."
                  disabled={!projectId}
                />
              )}
              <p className="text-xs text-text-sub mt-1">
                Tasks will be created in this phase
              </p>
            </div>

            {/* Notification User */}
            <div className="md:col-span-2">
              {usersLoading ? (
                <div className="h-10 flex items-center">
                  <Spinner size="sm" />
                </div>
              ) : (
                <Combobox
                  label="Notify User (for High/Critical bugs)"
                  options={userOptions}
                  value={notifyUserId}
                  onChange={(value) => {
                    setNotifyUserId(value || null);
                    setHasChanges(true);
                  }}
                  placeholder="Select a user..."
                  searchPlaceholder="Search users..."
                />
              )}
              <p className="text-xs text-text-sub mt-1">
                This user will receive a notification for Critical and High priority bug reports
              </p>
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end pt-4 border-t border-border">
            <Button
              onClick={handleSave}
              disabled={!hasChanges || updateSettings.isPending}
            >
              {updateSettings.isPending ? (
                <>
                  <Spinner size="sm" className="mr-2" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
