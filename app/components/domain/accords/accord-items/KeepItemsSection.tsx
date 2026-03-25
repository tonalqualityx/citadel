'use client';

import * as React from 'react';
import { Server, Plus, Trash2 } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { Checkbox } from '@/components/ui/checkbox';
import { EmptyState } from '@/components/ui/empty-state';
import { DiscountFields } from './DiscountFields';
import { useAccordKeepItems, useAddAccordKeepItem, useDeleteAccordKeepItem } from '@/lib/hooks/use-accord-items';
import { useHostingPlans, useMaintenancePlans } from '@/lib/hooks/use-reference-data';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { showToast } from '@/lib/hooks/use-toast';
import type { AccordKeepItem, HostingPlan, MaintenancePlan } from '@/types/entities';

interface KeepItemsSectionProps {
  accordId: string;
  clientId?: string | null;
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

const INITIAL_FORM = {
  site_name_placeholder: '',
  domain_name: '',
  is_client_hosted: false,
  hosting_plan_id: '' as string,
  hosting_price: '',
  hosting_discount_type: null as 'percent' | 'flat' | null,
  hosting_discount_value: null as number | null,
  maintenance_plan_id: '' as string,
  maintenance_price: '',
  maintenance_discount_type: null as 'percent' | 'flat' | null,
  maintenance_discount_value: null as number | null,
};

export function KeepItemsSection({ accordId }: KeepItemsSectionProps) {
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState(INITIAL_FORM);

  const { t } = useTerminology();
  const { data: items = [], isLoading } = useAccordKeepItems(accordId);
  const { data: hostingData } = useHostingPlans();
  const { data: maintenanceData } = useMaintenancePlans();
  const addItem = useAddAccordKeepItem();
  const deleteItem = useDeleteAccordKeepItem();

  const hostingPlans = hostingData?.hosting_plans || [];
  const maintenancePlans = maintenanceData?.maintenance_plans || [];

  const hostingOptions = hostingPlans.map((p: HostingPlan) => ({
    value: p.id,
    label: `${p.name} - ${formatCurrency(Number(p.rate))}/mo`,
  }));

  const maintenanceOptions = maintenancePlans.map((p: MaintenancePlan) => ({
    value: p.id,
    label: `${p.name} - ${formatCurrency(Number(p.rate))}/mo`,
  }));

  // Auto-fill prices when plans are selected
  const selectedHostingPlan = hostingPlans.find((p: HostingPlan) => p.id === form.hosting_plan_id);
  const selectedMaintenancePlan = maintenancePlans.find((p: MaintenancePlan) => p.id === form.maintenance_plan_id);

  React.useEffect(() => {
    if (selectedHostingPlan && !form.hosting_price) {
      setForm((prev) => ({ ...prev, hosting_price: Number(selectedHostingPlan.rate).toString() }));
    }
  }, [selectedHostingPlan]);

  React.useEffect(() => {
    if (selectedMaintenancePlan && !form.maintenance_price) {
      setForm((prev) => ({ ...prev, maintenance_price: Number(selectedMaintenancePlan.rate).toString() }));
    }
  }, [selectedMaintenancePlan]);

  const hostingPrice = parseFloat(form.hosting_price) || 0;
  const maintenancePrice = parseFloat(form.maintenance_price) || 0;

  const handleSubmit = () => {
    if (!form.maintenance_plan_id) {
      showToast.error('Maintenance plan is required');
      return;
    }
    if (!form.maintenance_price) {
      showToast.error('Maintenance price is required');
      return;
    }

    addItem.mutate(
      {
        accordId,
        data: {
          maintenance_plan_id: form.maintenance_plan_id,
          maintenance_price: maintenancePrice,
          site_name_placeholder: form.site_name_placeholder || null,
          domain_name: form.domain_name || null,
          is_client_hosted: form.is_client_hosted,
          hosting_plan_id: form.is_client_hosted ? null : (form.hosting_plan_id || null),
          hosting_price: form.is_client_hosted ? null : (hostingPrice || null),
          hosting_discount_type: form.is_client_hosted ? null : form.hosting_discount_type,
          hosting_discount_value: form.is_client_hosted ? null : form.hosting_discount_value,
          maintenance_discount_type: form.maintenance_discount_type,
          maintenance_discount_value: form.maintenance_discount_value,
        },
      },
      {
        onSuccess: () => {
          setForm(INITIAL_FORM);
          setShowForm(false);
        },
      }
    );
  };

  const handleDelete = (itemId: string) => {
    deleteItem.mutate({ accordId, itemId });
  };

  // Subtotals
  const monthlySubtotal = items.reduce((sum: number, item: AccordKeepItem) => sum + (item.monthly_total || 0), 0);

  return (
    <CollapsibleSection
      title={t('keeps')}
      icon={<Server className="h-4 w-4 text-text-sub" />}
      badge={items.length > 0 ? <Badge size="sm">{items.length}</Badge> : undefined}
      actions={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowForm(!showForm)}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add
        </Button>
      }
      defaultOpen
    >
      {/* Inline Add Form */}
      {showForm && (
        <div className="mb-4 p-3 bg-surface-alt rounded-lg border border-border space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Site Name"
              value={form.site_name_placeholder}
              onChange={(e) => setForm((prev) => ({ ...prev, site_name_placeholder: e.target.value }))}
              placeholder="e.g. Main Website"
            />
            <Input
              label="Domain"
              value={form.domain_name}
              onChange={(e) => setForm((prev) => ({ ...prev, domain_name: e.target.value }))}
              placeholder="e.g. example.com"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              checked={form.is_client_hosted}
              onCheckedChange={(checked) => setForm((prev) => ({
                ...prev,
                is_client_hosted: checked,
                hosting_plan_id: '',
                hosting_price: '',
                hosting_discount_type: null,
                hosting_discount_value: null,
              }))}
            />
            <label className="text-sm text-text-main">Client hosted</label>
          </div>

          {!form.is_client_hosted && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Hosting Plan"
                  value={form.hosting_plan_id}
                  onChange={(val) => setForm((prev) => ({ ...prev, hosting_plan_id: val, hosting_price: '' }))}
                  options={hostingOptions}
                  placeholder="Select hosting plan..."
                />
                <Input
                  label="Hosting Price"
                  type="number"
                  step="0.01"
                  min="0"
                  value={form.hosting_price}
                  onChange={(e) => setForm((prev) => ({ ...prev, hosting_price: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <DiscountFields
                basePrice={hostingPrice}
                discountType={form.hosting_discount_type}
                discountValue={form.hosting_discount_value}
                onChange={(type, value) => setForm((prev) => ({ ...prev, hosting_discount_type: type, hosting_discount_value: value }))}
                billingPeriodLabel="mo"
              />
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Maintenance Plan"
              value={form.maintenance_plan_id}
              onChange={(val) => setForm((prev) => ({ ...prev, maintenance_plan_id: val, maintenance_price: '' }))}
              options={maintenanceOptions}
              placeholder="Select maintenance plan..."
            />
            <Input
              label="Maintenance Price"
              type="number"
              step="0.01"
              min="0"
              value={form.maintenance_price}
              onChange={(e) => setForm((prev) => ({ ...prev, maintenance_price: e.target.value }))}
              placeholder="0.00"
            />
          </div>
          <DiscountFields
            basePrice={maintenancePrice}
            discountType={form.maintenance_discount_type}
            discountValue={form.maintenance_discount_value}
            onChange={(type, value) => setForm((prev) => ({ ...prev, maintenance_discount_type: type, maintenance_discount_value: value }))}
            billingPeriodLabel="mo"
          />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setForm(INITIAL_FORM); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={addItem.isPending}>
              {addItem.isPending ? 'Adding...' : `Add ${t('keep')}`}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-text-sub py-4 text-center">Loading...</div>
      ) : items.length === 0 && !showForm ? (
        <EmptyState
          icon={<Server className="h-8 w-8" />}
          title={`No ${t('keep').toLowerCase()} items`}
          description={`Add hosting and maintenance services to this accord.`}
          className="py-8"
        />
      ) : items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-sub">
                <th className="pb-2 pr-3 font-medium">Site/Name</th>
                <th className="pb-2 pr-3 font-medium">Domain</th>
                <th className="pb-2 pr-3 font-medium">Hosting</th>
                <th className="pb-2 pr-3 font-medium">Maintenance</th>
                <th className="pb-2 pr-3 font-medium text-right">Monthly Total</th>
                <th className="pb-2 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: AccordKeepItem) => (
                <tr key={item.id} className="border-b border-border last:border-0">
                  <td className="py-2 pr-3 text-text-main">
                    {item.site?.name || item.site_name_placeholder || 'Unnamed'}
                  </td>
                  <td className="py-2 pr-3 text-text-sub">
                    {item.domain_name || '--'}
                  </td>
                  <td className="py-2 pr-3 text-text-sub">
                    {item.is_client_hosted ? (
                      <Badge size="sm" variant="info">Client Hosted</Badge>
                    ) : item.hosting_plan ? (
                      <span>
                        {item.hosting_plan.name}
                        {item.hosting_final_price !== null && (
                          <span className="ml-1 text-text-main">{formatCurrency(item.hosting_final_price)}/mo</span>
                        )}
                      </span>
                    ) : '--'}
                  </td>
                  <td className="py-2 pr-3 text-text-sub">
                    {item.maintenance_plan ? (
                      <span>
                        {item.maintenance_plan.name}
                        {item.maintenance_final_price !== null && (
                          <span className="ml-1 text-text-main">{formatCurrency(item.maintenance_final_price)}/mo</span>
                        )}
                      </span>
                    ) : '--'}
                  </td>
                  <td className="py-2 pr-3 text-right font-medium text-text-main">
                    {item.monthly_total !== null ? formatCurrency(item.monthly_total) + '/mo' : '--'}
                  </td>
                  <td className="py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(item.id)}
                      disabled={deleteItem.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-text-sub hover:text-red-500" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Subtotals */}
          <div className="mt-3 pt-3 border-t border-border text-sm text-text-sub flex justify-end">
            <span>Monthly: <span className="font-medium text-text-main">{formatCurrency(monthlySubtotal)}/mo</span></span>
          </div>
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
