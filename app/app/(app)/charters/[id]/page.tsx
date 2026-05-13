'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Pause, Play, Plus, Trash2, XCircle } from 'lucide-react';
import {
  useCharter,
  useUpdateCharterStatus,
  useAddCharterWare,
  useRemoveCharterWare,
  useAddScheduledTask,
  useRemoveScheduledTask,
  useLinkCommission,
  useUnlinkCommission,
} from '@/lib/hooks/use-charters';
import { useWares } from '@/lib/hooks/use-wares';
import { useSops } from '@/lib/hooks/use-sops';
import { useProjects } from '@/lib/hooks/use-projects';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody, ModalFooter } from '@/components/ui/modal';
import { Combobox } from '@/components/ui/combobox';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CharterDetail } from '@/components/domain/charters/CharterDetail';
import { UsageTracker } from '@/components/domain/charters/UsageTracker';
import { CharterKanban } from '@/components/domain/charters/CharterKanban';
import { MeetingList } from '@/components/domain/meetings/MeetingList';
import type { CharterStatus, CharterScheduledTaskItem, CharterWareItem, CharterCommissionItem } from '@/types/entities';

const STATUS_COLORS: Record<CharterStatus, 'success' | 'warning' | 'error'> = {
  active: 'success',
  paused: 'warning',
  cancelled: 'error',
};

export default function CharterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTerminology();
  const id = params.id as string;

  const { data: charter, isLoading, error } = useCharter(id);
  const updateStatus = useUpdateCharterStatus();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }

  if (error || !charter) {
    return (
      <div className="text-center py-12">
        <p className="text-red-500 mb-4">
          {error ? 'Failed to load charter' : 'Charter not found'}
        </p>
        <Button variant="secondary" onClick={() => router.push('/charters')}>
          Back to {t('retainers')}
        </Button>
      </div>
    );
  }

  const handleStatusChange = (newStatus: CharterStatus) => {
    updateStatus.mutate({ id: charter.id, status: newStatus });
  };

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        href="/charters"
        className="inline-flex items-center gap-1.5 text-sm text-text-sub hover:text-text-main transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {t('retainers')}
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-main">{charter.name}</h1>
            <Badge variant={STATUS_COLORS[charter.status]} size="sm">
              {charter.status}
            </Badge>
          </div>
          {charter.client && (
            <p className="text-sm text-text-sub mt-1">
              {t('client')}: {charter.client.name}
            </p>
          )}
        </div>

        {/* Status actions */}
        <div className="flex items-center gap-2">
          {charter.status === 'active' && (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStatusChange('paused')}
                disabled={updateStatus.isPending}
              >
                <Pause className="h-4 w-4 mr-1.5" />
                Pause
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleStatusChange('cancelled')}
                disabled={updateStatus.isPending}
                className="text-red-600 hover:text-red-700"
              >
                <XCircle className="h-4 w-4 mr-1.5" />
                Cancel
              </Button>
            </>
          )}
          {charter.status === 'paused' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleStatusChange('active')}
              disabled={updateStatus.isPending}
            >
              <Play className="h-4 w-4 mr-1.5" />
              Reactivate
            </Button>
          )}
          {charter.status === 'cancelled' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleStatusChange('active')}
              disabled={updateStatus.isPending}
            >
              <Play className="h-4 w-4 mr-1.5" />
              Reactivate
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="tasks">{t('tasks')}</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="wares">{t('products')}</TabsTrigger>
          <TabsTrigger value="commissions">Commissions</TabsTrigger>
          <TabsTrigger value="meetings">Meetings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="mt-4 space-y-6">
            <UsageTracker
              charterId={charter.id}
              budgetHours={charter.budget_hours}
            />
            <CharterDetail charter={charter} />
          </div>
        </TabsContent>

        <TabsContent value="tasks">
          <div className="mt-4">
            <CharterKanban charterId={charter.id} />
          </div>
        </TabsContent>

        <TabsContent value="schedule">
          <ScheduleTab tasks={charter.scheduled_tasks ?? []} charterId={id} charterWares={charter.charter_wares ?? []} />
        </TabsContent>

        <TabsContent value="wares">
          <WaresTab wares={charter.charter_wares ?? []} charterId={id} />
        </TabsContent>

        <TabsContent value="commissions">
          <CommissionsTab commissions={charter.charter_commissions ?? []} charterId={id} />
        </TabsContent>

        <TabsContent value="meetings">
          <MeetingList charterId={id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* ── Schedule Tab ── */

function ScheduleTab({
  tasks,
  charterId,
  charterWares,
}: {
  tasks: CharterScheduledTaskItem[];
  charterId: string;
  charterWares: CharterWareItem[];
}) {
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [sopId, setSopId] = React.useState<string | null>(null);
  const [cadence, setCadence] = React.useState('monthly');
  const [charterWareId, setCharterWareId] = React.useState<string | null>(null);

  const { data: sopsData } = useSops({ limit: 100 });
  const addTask = useAddScheduledTask();
  const removeTask = useRemoveScheduledTask();

  const resetForm = () => {
    setSopId(null);
    setCadence('monthly');
    setCharterWareId(null);
  };

  const handleSubmit = () => {
    if (!sopId) return;
    addTask.mutate(
      {
        charterId,
        data: {
          sop_id: sopId,
          cadence,
          ...(charterWareId ? { charter_ware_id: charterWareId } : {}),
        },
      },
      {
        onSuccess: () => {
          setShowAddModal(false);
          resetForm();
        },
      },
    );
  };

  const cadenceOptions = [
    { value: 'weekly', label: 'Weekly' },
    { value: 'monthly', label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'semi_annually', label: 'Semi-Annually' },
    { value: 'annually', label: 'Annually' },
  ];

  const sopOptions = (sopsData?.sops ?? []).map((s) => ({
    value: s.id,
    label: s.title,
  }));

  const wareOptions = charterWares.map((w) => ({
    value: w.id,
    label: w.ware?.name ?? 'Unknown',
  }));

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-sub uppercase tracking-wider">Scheduled Tasks</h3>
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Task
        </Button>
      </div>

      {!tasks.length ? (
        <div className="text-center py-12 text-text-sub">
          No scheduled tasks yet
        </div>
      ) : (
        <div className="border border-border-warm rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-background-light border-b border-border-warm">
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  SOP
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Cadence
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Status
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-warm">
              {tasks.map((task) => (
                <tr key={task.id} className="hover:bg-surface/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-text-main">
                    {task.sop?.title ?? 'Unknown SOP'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge size="sm">{task.cadence}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={task.is_active ? 'success' : 'error'}
                      size="sm"
                    >
                      {task.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => removeTask.mutate({ charterId, taskId: task.id })}
                      disabled={removeTask.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAddModal} onOpenChange={(open) => { if (!open) { setShowAddModal(false); resetForm(); } }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add Scheduled Task</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <Combobox
              label="SOP"
              options={sopOptions}
              value={sopId}
              onChange={setSopId}
              placeholder="Select a SOP..."
            />
            <Select
              label="Cadence"
              options={cadenceOptions}
              value={cadence}
              onChange={setCadence}
            />
            {wareOptions.length > 0 && (
              <Combobox
                label="Charter Ware (optional)"
                options={wareOptions}
                value={charterWareId}
                onChange={setCharterWareId}
                placeholder="Select a ware..."
              />
            )}
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => { setShowAddModal(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!sopId || addTask.isPending}>
              {addTask.isPending ? 'Adding...' : 'Add Task'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

/* ── Wares Tab ── */
function WaresTab({ wares, charterId }: { wares: CharterWareItem[]; charterId: string }) {
  const { t } = useTerminology();
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [wareId, setWareId] = React.useState<string | null>(null);
  const [price, setPrice] = React.useState('');

  const { data: waresData } = useWares({ type: 'charter', is_active: true, limit: 100 });
  const addWare = useAddCharterWare();
  const removeWare = useRemoveCharterWare();

  const resetForm = () => {
    setWareId(null);
    setPrice('');
  };

  const wareOptions = (waresData?.wares ?? []).map((w) => ({
    value: w.id,
    label: w.name,
    description: w.base_price != null ? `$${w.base_price}` : undefined,
  }));

  const handleWareChange = (val: string | null) => {
    setWareId(val);
    if (val) {
      const selected = waresData?.wares?.find((w) => w.id === val);
      if (selected?.base_price != null) {
        setPrice(String(selected.base_price));
      }
    }
  };

  const handleSubmit = () => {
    if (!wareId) return;
    addWare.mutate(
      {
        charterId,
        data: { ware_id: wareId, price: price ? Number(price) : 0 },
      },
      {
        onSuccess: () => {
          setShowAddModal(false);
          resetForm();
        },
      },
    );
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-sub uppercase tracking-wider">{t('products')}</h3>
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add {t('product')}
        </Button>
      </div>

      {!wares.length ? (
        <div className="text-center py-12 text-text-sub">
          No {t('products').toLowerCase()} attached yet
        </div>
      ) : (
        <div className="border border-border-warm rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-background-light border-b border-border-warm">
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  {t('product')}
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Price
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Status
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-warm">
              {wares.map((item) => (
                <tr key={item.id} className="hover:bg-surface/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-text-main">
                    {item.ware ? (
                      <Link
                        href={`/deals/wares/${item.ware_id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {item.ware.name}
                      </Link>
                    ) : (
                      'Unknown'
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main text-right">
                    {formatCurrency(item.price)}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={item.is_active ? 'success' : 'error'}
                      size="sm"
                    >
                      {item.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => removeWare.mutate({ charterId, wareId: item.id })}
                      disabled={removeWare.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAddModal} onOpenChange={(open) => { if (!open) { setShowAddModal(false); resetForm(); } }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Add {t('product')}</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <Combobox
              label={t('product')}
              options={wareOptions}
              value={wareId}
              onChange={handleWareChange}
              placeholder={`Select a ${t('product').toLowerCase()}...`}
            />
            <Input
              label="Price"
              type="number"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="0"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => { setShowAddModal(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!wareId || addWare.isPending}>
              {addWare.isPending ? 'Adding...' : `Add ${t('product')}`}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

function formatCurrency(amount: number | null) {
  if (amount == null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
  }).format(amount);
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '--';
  const parts = dateStr.split('T')[0].split('-');
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatPeriod(period: string | null) {
  if (!period) return '--';
  const [year, month] = period.split('-');
  if (!year || !month) return period;
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/* ── Commissions Tab ── */
function CommissionsTab({ commissions, charterId }: { commissions: CharterCommissionItem[]; charterId: string }) {
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [commissionId, setCommissionId] = React.useState<string | null>(null);
  const [startPeriod, setStartPeriod] = React.useState('');
  const [endPeriod, setEndPeriod] = React.useState('');
  const [allocatedHours, setAllocatedHours] = React.useState('');

  const { data: projectsData } = useProjects({ limit: 100 });
  const linkCommission = useLinkCommission();
  const unlinkCommission = useUnlinkCommission();

  const resetForm = () => {
    setCommissionId(null);
    setStartPeriod('');
    setEndPeriod('');
    setAllocatedHours('');
  };

  const projectOptions = (projectsData?.projects ?? []).map((p) => ({
    value: p.id,
    label: p.name,
    description: p.status,
  }));

  const handleSubmit = () => {
    if (!commissionId || !startPeriod) return;
    linkCommission.mutate(
      {
        charterId,
        data: {
          commission_id: commissionId,
          start_period: startPeriod,
          ...(endPeriod ? { end_period: endPeriod } : {}),
          ...(allocatedHours ? { allocated_hours_per_period: Number(allocatedHours) } : {}),
        },
      },
      {
        onSuccess: () => {
          setShowAddModal(false);
          resetForm();
        },
      },
    );
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-text-sub uppercase tracking-wider">Commissions</h3>
        <Button size="sm" onClick={() => setShowAddModal(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Link Commission
        </Button>
      </div>

      {!commissions.length ? (
        <div className="text-center py-12 text-text-sub">
          No commissions linked yet
        </div>
      ) : (
        <div className="border border-border-warm rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-background-light border-b border-border-warm">
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Commission
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Period
                </th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Hours/Period
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-text-sub uppercase tracking-wider">
                  Status
                </th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border-warm">
              {commissions.map((link) => (
                <tr key={link.id} className="hover:bg-surface/50 transition-colors">
                  <td className="px-4 py-3 text-sm text-text-main">
                    {link.commission ? (
                      <Link
                        href={`/projects/${link.commission_id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {link.commission.name}
                      </Link>
                    ) : (
                      'Unknown'
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-sub">
                    {formatPeriod(link.start_period)}
                    {link.end_period ? ` - ${formatPeriod(link.end_period)}` : ' - ongoing'}
                  </td>
                  <td className="px-4 py-3 text-sm text-text-main text-right">
                    {link.allocated_hours_per_period != null
                      ? `${link.allocated_hours_per_period}h`
                      : '--'}
                  </td>
                  <td className="px-4 py-3">
                    <Badge
                      variant={link.is_active ? 'success' : 'error'}
                      size="sm"
                    >
                      {link.is_active ? 'Active' : 'Completed'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-500 hover:text-red-700"
                      onClick={() => unlinkCommission.mutate({ charterId, linkId: link.id })}
                      disabled={unlinkCommission.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={showAddModal} onOpenChange={(open) => { if (!open) { setShowAddModal(false); resetForm(); } }}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Link Commission</ModalTitle>
          </ModalHeader>
          <ModalBody className="space-y-4">
            <Combobox
              label="Commission"
              options={projectOptions}
              value={commissionId}
              onChange={setCommissionId}
              placeholder="Select a project..."
            />
            <Input
              label="Start Period"
              type="month"
              value={startPeriod}
              onChange={(e) => setStartPeriod(e.target.value)}
            />
            <Input
              label="End Period (optional)"
              type="month"
              value={endPeriod}
              onChange={(e) => setEndPeriod(e.target.value)}
            />
            <Input
              label="Allocated Hours/Period (optional)"
              type="number"
              value={allocatedHours}
              onChange={(e) => setAllocatedHours(e.target.value)}
              placeholder="0"
            />
          </ModalBody>
          <ModalFooter>
            <Button variant="secondary" onClick={() => { setShowAddModal(false); resetForm(); }}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={!commissionId || !startPeriod || linkCommission.isPending}>
              {linkCommission.isPending ? 'Linking...' : 'Link Commission'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}
