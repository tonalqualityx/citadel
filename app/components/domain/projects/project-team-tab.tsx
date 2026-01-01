'use client';

import * as React from 'react';
import { Plus, X, Users, Crown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
  ModalFooter,
} from '@/components/ui/modal';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import { useUsers } from '@/lib/hooks/use-users';
import {
  useProjectTeam,
  useAddTeamMember,
  useRemoveTeamMember,
  type TeamAssignment,
} from '@/lib/hooks/use-projects';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { useAuth } from '@/lib/hooks/use-auth';
interface ProjectTeamTabProps {
  projectId: string;
  tasks?: Array<{ function_id?: string | null; function?: { id: string; name: string } | null }>;
}

export function ProjectTeamTab({ projectId, tasks = [] }: ProjectTeamTabProps) {
  const { t } = useTerminology();
  const { user } = useAuth();
  const canEdit = user?.role === 'pm' || user?.role === 'admin';

  const [isAddModalOpen, setIsAddModalOpen] = React.useState(false);
  const [selectedFunctionId, setSelectedFunctionId] = React.useState<string>('');
  const [selectedUserId, setSelectedUserId] = React.useState<string>('');
  const [editingFunctionId, setEditingFunctionId] = React.useState<string | null>(null);

  const { data: teamData, isLoading: teamLoading } = useProjectTeam(projectId);
  const { data: functionsData, isLoading: functionsLoading } = useFunctions();
  const { data: usersData } = useUsers();

  const addMutation = useAddTeamMember();
  const removeMutation = useRemoveTeamMember();

  const teamAssignments = teamData?.team || [];
  const allFunctions = functionsData?.functions || [];
  const allUsers = usersData?.users || [];

  // Get functions from tasks
  const taskFunctionIds = new Set(
    tasks.filter((t) => t.function_id).map((t) => t.function_id!)
  );

  // Get currently assigned function IDs
  const assignedFunctionIds = new Set(teamAssignments.map((a) => a.function_id));

  // Combine: functions from tasks + assigned functions
  const projectFunctionIds = new Set([...taskFunctionIds, ...assignedFunctionIds]);

  // Get function details for display
  const projectFunctions = allFunctions.filter((f) => projectFunctionIds.has(f.id));

  // Functions available to add (not yet assigned to project)
  const availableFunctions = allFunctions.filter((f) => !assignedFunctionIds.has(f.id));

  // Get task count per function
  const taskCountByFunction = tasks.reduce((acc, task) => {
    if (task.function_id) {
      acc[task.function_id] = (acc[task.function_id] || 0) + 1;
    }
    return acc;
  }, {} as Record<string, number>);

  // Get users qualified for the currently selected function (for add modal)
  const qualifiedUsersForSelected = React.useMemo(() => {
    if (!selectedFunctionId) return [];
    // Find users who have this function in their user_functions
    // For now, we'll fetch from the API when the modal opens
    return allUsers.filter((u) => u.is_active);
  }, [selectedFunctionId, allUsers]);

  const handleAddFunction = async () => {
    if (!selectedFunctionId || !selectedUserId) return;
    await addMutation.mutateAsync({
      projectId,
      data: { function_id: selectedFunctionId, user_id: selectedUserId },
    });
    setIsAddModalOpen(false);
    setSelectedFunctionId('');
    setSelectedUserId('');
  };

  const handleRemoveFunction = async (functionId: string) => {
    await removeMutation.mutateAsync({ projectId, functionId });
  };

  const handleAssignUser = async (functionId: string, userId: string) => {
    // First remove existing assignment for this function
    await removeMutation.mutateAsync({ projectId, functionId });
    // Then add new assignment
    await addMutation.mutateAsync({
      projectId,
      data: { function_id: functionId, user_id: userId },
    });
    setEditingFunctionId(null);
  };

  if (teamLoading || functionsLoading) {
    return (
      <Card>
        <CardContent className="py-8">
          <div className="flex items-center justify-center">
            <Spinner size="lg" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Team</CardTitle>
          {canEdit && availableFunctions.length > 0 && (
            <Button size="sm" onClick={() => setIsAddModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Function
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {projectFunctions.length > 0 ? (
            <div className="space-y-3">
              {projectFunctions.map((func) => {
                const assignment = teamAssignments.find((a) => a.function_id === func.id);
                const taskCount = taskCountByFunction[func.id] || 0;
                const isEditing = editingFunctionId === func.id;

                return (
                  <div
                    key={func.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border bg-surface"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium text-text-main">{func.name}</span>
                        {taskCount > 0 && (
                          <Badge variant="default" className="text-xs">
                            {taskCount} {taskCount === 1 ? t('task') : t('tasks')}
                          </Badge>
                        )}
                        {assignment?.is_lead && (
                          <Badge variant="warning" className="text-xs">
                            <Crown className="h-3 w-3 mr-1" />
                            Lead
                          </Badge>
                        )}
                      </div>

                      {isEditing && canEdit ? (
                        <div className="flex items-center gap-2 mt-2">
                          <Select
                            options={[
                              { value: '', label: 'Select user...' },
                              ...allUsers
                                .filter((u) => u.is_active)
                                .map((u) => ({ value: u.id, label: u.name })),
                            ]}
                            value={selectedUserId}
                            onChange={setSelectedUserId}
                            className="w-48"
                          />
                          <Button
                            size="sm"
                            onClick={() => selectedUserId && handleAssignUser(func.id, selectedUserId)}
                            disabled={!selectedUserId || addMutation.isPending}
                          >
                            Assign
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingFunctionId(null);
                              setSelectedUserId('');
                            }}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : assignment?.user ? (
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-medium">
                            {assignment.user.name.charAt(0)}
                          </div>
                          <span className="text-sm text-text-sub">{assignment.user.name}</span>
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-text-sub hover:text-text-main"
                              onClick={() => {
                                setEditingFunctionId(func.id);
                                setSelectedUserId(assignment.user_id);
                              }}
                            >
                              Change
                            </Button>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-sub italic">Unassigned</span>
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs"
                              onClick={() => {
                                setEditingFunctionId(func.id);
                                setSelectedUserId('');
                              }}
                            >
                              Assign
                            </Button>
                          )}
                        </div>
                      )}
                    </div>

                    {canEdit && assignment && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleRemoveFunction(func.id)}
                        disabled={removeMutation.isPending}
                        className="text-red-500 hover:text-red-700"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={<Users className="h-10 w-10" />}
              title="No team functions"
              description={canEdit
                ? `Add functions and assign team members to this ${t('project').toLowerCase()}`
                : `No team members assigned to this ${t('project').toLowerCase()}`
              }
              action={
                canEdit && availableFunctions.length > 0 ? (
                  <Button onClick={() => setIsAddModalOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Function
                  </Button>
                ) : undefined
              }
            />
          )}
        </CardContent>
      </Card>

      {/* Add Function Modal */}
      <Modal open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add Function to Team</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-main mb-1">
                Function
              </label>
              <Select
                options={[
                  { value: '', label: 'Select function...' },
                  ...availableFunctions.map((f) => ({ value: f.id, label: f.name })),
                ]}
                value={selectedFunctionId}
                onChange={(value) => {
                  setSelectedFunctionId(value);
                  setSelectedUserId('');
                }}
              />
            </div>
            {selectedFunctionId && (
              <div>
                <label className="block text-sm font-medium text-text-main mb-1">
                  Assign to User
                </label>
                <Select
                  options={[
                    { value: '', label: 'Select user...' },
                    ...allUsers
                      .filter((u) => u.is_active)
                      .map((u) => ({ value: u.id, label: u.name })),
                  ]}
                  value={selectedUserId}
                  onChange={setSelectedUserId}
                />
                <p className="text-xs text-text-sub mt-1">
                  Select a team member to assign to this function
                </p>
              </div>
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="ghost" onClick={() => setIsAddModalOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleAddFunction}
              disabled={!selectedFunctionId || !selectedUserId || addMutation.isPending}
            >
              {addMutation.isPending ? 'Adding...' : 'Add to Team'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}
