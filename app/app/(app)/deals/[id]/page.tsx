'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Plus,
  Trash2,
  Calendar,
  User,
  Mail,
  Phone,
  Building2,
  Package,
  FileText,
  Send,
  Eye,
  Pencil,
  CheckSquare,
} from 'lucide-react';
import {
  useAccord,
  useUpdateAccord,
} from '@/lib/hooks/use-accords';
import { CharterItemsSection } from '@/components/domain/accords/accord-items/CharterItemsSection';
import { CommissionItemsSection } from '@/components/domain/accords/accord-items/CommissionItemsSection';
import { KeepItemsSection } from '@/components/domain/accords/accord-items/KeepItemsSection';
import { InlineText } from '@/components/ui/inline-edit/inline-text';
import { useProposals } from '@/lib/hooks/use-proposals';
import { useContracts, useCreateContract, useSendContract, useDeleteContract } from '@/lib/hooks/use-contracts';
import { useTasks, useUpdateTask } from '@/lib/hooks/use-tasks';
import { ProposalVersionList } from '@/components/domain/proposals/ProposalVersionList';
import { ProposalEditor } from '@/components/domain/proposals/ProposalEditor';
import { ProposalPreview } from '@/components/domain/proposals/ProposalPreview';
import { AddendumList } from '@/components/domain/addendums/AddendumList';
import { AddendumForm } from '@/components/domain/addendums/AddendumForm';
import { ContractViewer } from '@/components/domain/contracts/ContractViewer';
import { ContractEditor } from '@/components/domain/contracts/ContractEditor';
import { useAddendums } from '@/lib/hooks/use-addendums';
import { MeetingList } from '@/components/domain/meetings/MeetingList';
import { TaskForm } from '@/components/domain/tasks/task-form';
import { TaskPeekDrawer } from '@/components/domain/tasks/task-peek-drawer';
import { TaskList } from '@/components/ui/task-list';
import {
  titleColumn,
  statusColumn,
  priorityColumn,
  assigneeColumn,
  rangedEstimateColumn,
  batteryColumn,
} from '@/components/ui/task-list-columns';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Avatar } from '@/components/ui/avatar';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import {
  Modal,
  ModalContent,
  ModalHeader,
  ModalTitle,
  ModalBody,
} from '@/components/ui/modal';
import type { AccordStatus } from '@/types/entities';
import type { Task } from '@/lib/hooks/use-tasks';

const STATUS_BADGE_MAP: Record<
  AccordStatus,
  'default' | 'info' | 'warning' | 'purple' | 'success' | 'error'
> = {
  lead: 'default',
  meeting: 'info',
  proposal: 'warning',
  contract: 'purple',
  signed: 'success',
  active: 'success',
  lost: 'error',
};

// Status progression order for determining which tabs show content vs empty state
const STATUS_ORDER: AccordStatus[] = ['lead', 'meeting', 'proposal', 'contract', 'signed', 'active'];

function isAtOrPastStage(currentStatus: AccordStatus, requiredStage: AccordStatus): boolean {
  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  const requiredIndex = STATUS_ORDER.indexOf(requiredStage);
  if (currentIndex === -1 || requiredIndex === -1) return false;
  return currentIndex >= requiredIndex;
}

function formatCurrency(value: number | null): string {
  if (value == null) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  }).format(value);
}

function formatDate(date: string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export default function AccordDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTerminology();
  const id = params.id as string;

  const { data: accord, isLoading, error } = useAccord(id);
  const updateAccord = useUpdateAccord();
  const { data: proposalsData } = useProposals(id);
  const { data: contractsData } = useContracts(id);
  const createContract = useCreateContract();
  const sendContract = useSendContract();
  const deleteContract = useDeleteContract();

  const { data: addendumsData } = useAddendums(id);

  // Tasks
  const { data: tasksData, isLoading: tasksLoading } = useTasks({ accord_id: id, limit: 100 });
  const updateTask = useUpdateTask();

  // Addendum editor state
  const [editingAddendumId, setEditingAddendumId] = React.useState<string | null>(null);

  // Proposal editor/preview state
  const [editingProposalId, setEditingProposalId] = React.useState<string | null>(null);
  const [previewingProposalId, setPreviewingProposalId] = React.useState<string | null>(null);

  // Contract viewer/editor state
  const [viewingContractId, setViewingContractId] = React.useState<string | null>(null);
  const [editingContractId, setEditingContractId] = React.useState<string | null>(null);

  // Task create/peek state
  const [isTaskCreateOpen, setIsTaskCreateOpen] = React.useState(false);
  const [peekTaskId, setPeekTaskId] = React.useState<string | null>(null);
  const [isPeekOpen, setIsPeekOpen] = React.useState(false);

  const handleTaskClick = (task: Task) => {
    setPeekTaskId(task.id);
    setIsPeekOpen(true);
  };

  const handleTaskUpdate = (taskId: string, updates: Partial<Task>) => {
    updateTask.mutate({ id: taskId, data: updates as any });
  };

  const taskColumns = [
    titleColumn({ editable: true }),
    statusColumn({ editable: true }),
    priorityColumn({ editable: true }),
    assigneeColumn({ editable: true }),
    rangedEstimateColumn(),
    batteryColumn({ editable: true }),
  ];

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !accord) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Package className="h-12 w-12" />}
          title="Accord not found"
          description="The accord you're looking for doesn't exist or has been deleted."
          action={
            <Button onClick={() => router.push('/deals')}>
              Back to {t('deals')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back link */}
      <Button
        variant="ghost"
        size="sm"
        onClick={() => router.push('/deals')}
        className="gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {t('deals')}
      </Button>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-text-main">
              {accord.name}
            </h1>
            <Badge variant={STATUS_BADGE_MAP[accord.status]} size="lg">
              {accord.status.charAt(0).toUpperCase() + accord.status.slice(1)}
            </Badge>
          </div>

          <div className="flex items-center gap-4 text-sm text-text-sub">
            {accord.client ? (
              <Link
                href={`/clients/${accord.client.id}`}
                className="hover:text-primary transition-colors flex items-center gap-1"
              >
                <Building2 className="h-4 w-4" />
                {accord.client.name}
              </Link>
            ) : accord.lead_name ? (
              <span className="flex items-center gap-1">
                <User className="h-4 w-4" />
                {accord.lead_name}
                {accord.lead_business_name && ` - ${accord.lead_business_name}`}
              </span>
            ) : null}

            {accord.owner && (
              <span className="flex items-center gap-2">
                <Avatar
                  src={accord.owner.avatar_url}
                  name={accord.owner.name}
                  size="xs"
                />
                {accord.owner.name}
              </span>
            )}

            <span className="flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              {formatDate(accord.created_at)}
            </span>
          </div>
        </div>

        <div className="text-right">
          <div className="text-2xl font-bold text-text-main">
            {formatCurrency(accord.total_value)}
          </div>
          <div className="text-sm text-text-sub">Total Value</div>
        </div>
      </div>

      {/* Revenue Summary */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-sub font-medium uppercase tracking-wider">MRR</div>
            <div className="text-xl font-bold text-text-main mt-1">
              {formatCurrency(accord.mrr || 0)}<span className="text-sm font-normal text-text-sub">/mo</span>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-sub font-medium uppercase tracking-wider">Project Value</div>
            <div className="text-xl font-bold text-text-main mt-1">
              {accord.total_project_value == null
                ? <>{formatCurrency(0)} <Badge variant="warning" size="sm">+ TBD</Badge></>
                : formatCurrency(accord.total_project_value)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-text-sub font-medium uppercase tracking-wider">Contract Value</div>
            <div className="text-xl font-bold text-text-main mt-1">
              {accord.total_contract_value == null
                ? <>{formatCurrency(0)} <Badge variant="warning" size="sm">+ TBD</Badge></>
                : formatCurrency(accord.total_contract_value)}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
          <TabsTrigger value="tasks">{t('tasks')}</TabsTrigger>
          <TabsTrigger value="proposals">Proposals</TabsTrigger>
          <TabsTrigger value="contracts">Contracts</TabsTrigger>
          <TabsTrigger value="addendums">Addendums</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6 mt-4">
          {/* Lead / Client Info */}
          <Card>
            <CardHeader>
              <CardTitle>
                {accord.client ? t('client') : 'Lead'} Information
              </CardTitle>
            </CardHeader>
            <CardContent>
              {accord.client ? (
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-text-sub" />
                  <div>
                    <Link
                      href={`/clients/${accord.client.id}`}
                      className="font-medium text-text-main hover:text-primary transition-colors"
                    >
                      {accord.client.name}
                    </Link>
                    <Badge variant="default" size="sm" className="ml-2">
                      {accord.client.status}
                    </Badge>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4 text-text-sub flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-text-sub">Name</div>
                      <InlineText
                        value={accord.lead_name}
                        onChange={(val) => updateAccord.mutate({ id, data: { lead_name: val } })}
                        placeholder="Add lead name..."
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-text-sub flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-text-sub">Business</div>
                      <InlineText
                        value={accord.lead_business_name}
                        onChange={(val) => updateAccord.mutate({ id, data: { lead_business_name: val } })}
                        placeholder="Add business name..."
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-text-sub flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-text-sub">Email</div>
                      <InlineText
                        value={accord.lead_email}
                        onChange={(val) => updateAccord.mutate({ id, data: { lead_email: val } })}
                        placeholder="Add email..."
                        type="email"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4 text-text-sub flex-shrink-0" />
                    <div className="flex-1">
                      <div className="text-xs text-text-sub">Phone</div>
                      <InlineText
                        value={accord.lead_phone}
                        onChange={(val) => updateAccord.mutate({ id, data: { lead_phone: val } })}
                        placeholder="Add phone..."
                        type="tel"
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Line Items — Three Sections */}
          <CharterItemsSection accordId={id} />
          <CommissionItemsSection accordId={id} clientId={accord.client_id} />
          <KeepItemsSection accordId={id} clientId={accord.client_id} />

          {/* Proposals Summary */}
          {proposalsData?.proposals && proposalsData.proposals.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Latest Proposal</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-sm text-text-main font-medium">
                      Version {proposalsData.proposals[0].version}
                    </span>
                    <span className="text-sm text-text-sub ml-2">
                      {formatDate(proposalsData.proposals[0].created_at)}
                    </span>
                  </div>
                  <Badge
                    variant={
                      proposalsData.proposals[0].status === 'accepted'
                        ? 'success'
                        : proposalsData.proposals[0].status === 'rejected'
                          ? 'error'
                          : proposalsData.proposals[0].status === 'sent'
                            ? 'info'
                            : 'default'
                    }
                    size="sm"
                  >
                    {proposalsData.proposals[0].status.replace('_', ' ')}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Meetings Tab */}
        <TabsContent value="meetings" className="space-y-6 mt-4">
          <MeetingList
            accordId={id}
            clientId={accord.client_id || undefined}
          />
        </TabsContent>

        {/* Tasks Tab */}
        <TabsContent value="tasks" className="space-y-6 mt-4">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t('tasks')}</CardTitle>
              <Button
                size="sm"
                onClick={() => setIsTaskCreateOpen(true)}
              >
                <Plus className="h-4 w-4 mr-1" />
                New {t('task')}
              </Button>
            </CardHeader>
            <CardContent>
              {tasksLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Spinner size="md" />
                </div>
              ) : tasksData?.tasks && tasksData.tasks.length > 0 ? (
                <TaskList
                  tasks={tasksData.tasks}
                  columns={taskColumns}
                  onTaskClick={handleTaskClick}
                  onTaskUpdate={handleTaskUpdate}
                  emptyMessage={`No ${t('tasks').toLowerCase()} for this accord.`}
                />
              ) : (
                <EmptyState
                  icon={<CheckSquare className="h-8 w-8" />}
                  title={`No ${t('tasks').toLowerCase()} yet`}
                  description={`Create ${t('tasks').toLowerCase()} to track work for this accord.`}
                  className="py-8"
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proposals Tab */}
        <TabsContent value="proposals" className="space-y-6 mt-4">
          {isAtOrPastStage(accord.status, 'proposal') ? (
            <>
              {editingProposalId ? (
                <Card>
                  <CardContent className="pt-6">
                    <ProposalEditor
                      accordId={id}
                      proposalId={editingProposalId}
                      onClose={() => setEditingProposalId(null)}
                    />
                  </CardContent>
                </Card>
              ) : previewingProposalId ? (
                <Card>
                  <CardContent className="pt-6">
                    <ProposalPreview
                      accordId={id}
                      proposalId={previewingProposalId}
                      onClose={() => setPreviewingProposalId(null)}
                    />
                  </CardContent>
                </Card>
              ) : (
                <ProposalVersionList
                  accordId={id}
                  onEdit={setEditingProposalId}
                  onPreview={setPreviewingProposalId}
                />
              )}
            </>
          ) : (
            <div className="text-center py-12 text-text-secondary">
              <p>Move this accord to the proposal stage to create proposals.</p>
            </div>
          )}
        </TabsContent>

        {/* Contracts Tab */}
        <TabsContent value="contracts" className="space-y-6 mt-4">
          {isAtOrPastStage(accord.status, 'contract') ? (
            <>
              {viewingContractId ? (
                <Card>
                  <CardContent className="pt-6">
                    <ContractViewer
                      accordId={id}
                      contractId={viewingContractId}
                      onClose={() => setViewingContractId(null)}
                    />
                  </CardContent>
                </Card>
              ) : editingContractId ? (
                <Card>
                  <CardContent className="pt-6">
                    <ContractEditor
                      accordId={id}
                      contractId={editingContractId}
                      onClose={() => setEditingContractId(null)}
                    />
                  </CardContent>
                </Card>
              ) : (
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Contracts</CardTitle>
                    <Button
                      size="sm"
                      onClick={() => createContract.mutate({ accordId: id })}
                      disabled={createContract.isPending}
                    >
                      <Plus className="h-4 w-4 mr-1" />
                      {createContract.isPending ? 'Generating...' : 'Generate Contract'}
                    </Button>
                  </CardHeader>
                  <CardContent>
                    {contractsData?.contracts && contractsData.contracts.length > 0 ? (
                      <div className="space-y-3">
                        {contractsData.contracts.map((contract) => (
                          <div
                            key={contract.id}
                            className="flex items-center justify-between py-3 px-4 rounded-lg border border-border-warm"
                          >
                            <div className="flex items-center gap-4">
                              <div>
                                <span className="text-sm font-medium text-text-main">
                                  Version {contract.version}
                                </span>
                                <span className="text-sm text-text-sub ml-2">
                                  {formatDate(contract.created_at)}
                                </span>
                                {contract.msa_version && (
                                  <span className="text-xs text-text-sub ml-2">
                                    MSA {contract.msa_version.version}
                                  </span>
                                )}
                              </div>
                              <Badge
                                variant={
                                  contract.status === 'signed'
                                    ? 'success'
                                    : contract.status === 'sent'
                                      ? 'info'
                                      : 'default'
                                }
                                size="sm"
                              >
                                {contract.status}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2">
                              {/* View button for sent/signed contracts */}
                              {(contract.status === 'sent' || contract.status === 'signed') && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setViewingContractId(contract.id)}
                                >
                                  <Eye className="h-3.5 w-3.5 mr-1" />
                                  View
                                </Button>
                              )}
                              {contract.status === 'draft' && (
                                <>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setEditingContractId(contract.id)}
                                  >
                                    <Pencil className="h-3.5 w-3.5 mr-1" />
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => sendContract.mutate({ accordId: id, contractId: contract.id })}
                                    disabled={sendContract.isPending}
                                  >
                                    <Send className="h-3.5 w-3.5 mr-1" />
                                    Send
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => deleteContract.mutate({ accordId: id, contractId: contract.id })}
                                    disabled={deleteContract.isPending}
                                  >
                                    <Trash2 className="h-3.5 w-3.5 text-text-sub hover:text-red-500" />
                                  </Button>
                                </>
                              )}
                              {contract.status === 'signed' && contract.signed_at && (
                                <span className="text-xs text-text-sub">
                                  Signed {formatDate(contract.signed_at)}
                                  {contract.signer_name && ` by ${contract.signer_name}`}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState
                        icon={<FileText className="h-8 w-8" />}
                        title="No contracts yet"
                        description="Generate a contract from the accord's line items and MSA."
                        className="py-8"
                      />
                    )}
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <div className="text-center py-12 text-text-secondary">
              <p>A contract will be generated when the client accepts a proposal.</p>
            </div>
          )}
        </TabsContent>

        {/* Addendums Tab */}
        <TabsContent value="addendums" className="space-y-6 mt-4">
          {isAtOrPastStage(accord.status, 'signed') ? (
            <>
              {editingAddendumId ? (
                <Card>
                  <CardContent className="pt-6">
                    <AddendumForm
                      accordId={id}
                      onClose={() => setEditingAddendumId(null)}
                    />
                  </CardContent>
                </Card>
              ) : (
                <AddendumList
                  accordId={id}
                  onEdit={setEditingAddendumId}
                  onCreate={() => setEditingAddendumId('new')}
                />
              )}
            </>
          ) : (
            <div className="text-center py-12 text-text-secondary">
              <p>Addendums can be created after the accord is signed.</p>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Task Create Modal */}
      <Modal open={isTaskCreateOpen} onOpenChange={setIsTaskCreateOpen}>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>Create {t('task')}</ModalTitle>
          </ModalHeader>
          <ModalBody>
            <TaskForm
              defaultAccordId={id}
              defaultClientId={accord.client_id || undefined}
              onSuccess={() => setIsTaskCreateOpen(false)}
              onCancel={() => setIsTaskCreateOpen(false)}
            />
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Task Peek Drawer */}
      <TaskPeekDrawer
        taskId={peekTaskId}
        open={isPeekOpen}
        onOpenChange={setIsPeekOpen}
      />
    </div>
  );
}
