'use client';

import * as React from 'react';
import { Briefcase, Plus, Trash2 } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { DiscountFields } from './DiscountFields';
import { useAccordCommissionItems, useAddAccordCommissionItem, useDeleteAccordCommissionItem } from '@/lib/hooks/use-accord-items';
import { useWares } from '@/lib/hooks/use-wares';
import { useProjects } from '@/lib/hooks/use-projects';
import { showToast } from '@/lib/hooks/use-toast';
import type { AccordCommissionItem } from '@/types/entities';

interface CommissionItemsSectionProps {
  accordId: string;
  clientId?: string | null;
}

const formatCurrency = (value: number): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);

function calculateFinalPrice(basePrice: number, discountType: 'percent' | 'flat' | null, discountValue: number | null): number {
  if (!discountType || !discountValue) return basePrice;
  if (discountType === 'percent') return Math.max(0, basePrice * (1 - discountValue / 100));
  if (discountType === 'flat') return Math.max(0, basePrice - discountValue);
  return basePrice;
}

const INITIAL_FORM = {
  ware_id: null as string | null,
  name_override: '',
  estimated_price: '',
  project_id: null as string | null,
  discount_type: null as 'percent' | 'flat' | null,
  discount_value: null as number | null,
};

export function CommissionItemsSection({ accordId, clientId }: CommissionItemsSectionProps) {
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState(INITIAL_FORM);

  const { data: items = [], isLoading } = useAccordCommissionItems(accordId);
  const { data: waresData } = useWares({ type: 'commission', is_active: true, limit: 100 });
  const { data: projectsData } = useProjects(clientId ? { client_id: clientId, limit: 100 } : { limit: 100 });
  const addItem = useAddAccordCommissionItem();
  const deleteItem = useDeleteAccordCommissionItem();

  const wares = waresData?.wares || [];
  const projects = projectsData?.projects || [];

  const wareOptions = wares.map((w) => ({
    value: w.id,
    label: w.name,
    description: w.base_price ? formatCurrency(w.base_price) : undefined,
  }));

  const projectOptions = projects.map((p) => ({
    value: p.id,
    label: p.name,
  }));

  const selectedWare = wares.find((w) => w.id === form.ware_id);

  // Auto-fill estimated price from ware
  React.useEffect(() => {
    if (selectedWare?.base_price && !form.estimated_price) {
      setForm((prev) => ({ ...prev, estimated_price: selectedWare.base_price!.toString() }));
    }
  }, [selectedWare]);

  const estimatedPrice = parseFloat(form.estimated_price) || 0;
  const finalPrice = estimatedPrice > 0 ? calculateFinalPrice(estimatedPrice, form.discount_type, form.discount_value) : null;

  const handleSubmit = () => {
    if (!form.ware_id) {
      showToast.error('Ware is required');
      return;
    }

    addItem.mutate(
      {
        accordId,
        data: {
          ware_id: form.ware_id,
          name_override: form.name_override || undefined,
          estimated_price: estimatedPrice > 0 ? estimatedPrice : null,
          project_id: form.project_id,
          discount_type: form.discount_type,
          discount_value: form.discount_value,
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
  const pricedItems = items.filter((i: AccordCommissionItem) => i.final_price !== null);
  const unpricedCount = items.length - pricedItems.length;
  const pricedTotal = pricedItems.reduce((sum: number, item: AccordCommissionItem) => sum + (item.final_price || 0), 0);

  return (
    <CollapsibleSection
      title="Commissions"
      icon={<Briefcase className="h-4 w-4 text-text-sub" />}
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
            <Combobox
              label="Ware"
              options={wareOptions}
              value={form.ware_id}
              onChange={(val) => setForm((prev) => ({ ...prev, ware_id: val, estimated_price: '' }))}
              placeholder="Select commission ware..."
              searchPlaceholder="Search wares..."
            />
            <Input
              label="Name Override"
              value={form.name_override}
              onChange={(e) => setForm((prev) => ({ ...prev, name_override: e.target.value }))}
              placeholder="Optional name override"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Estimated Price"
              type="number"
              step="0.01"
              min="0"
              value={form.estimated_price}
              onChange={(e) => setForm((prev) => ({ ...prev, estimated_price: e.target.value }))}
              placeholder="0.00 (leave blank for TBD)"
            />
            <Combobox
              label="Project"
              options={projectOptions}
              value={form.project_id}
              onChange={(val) => setForm((prev) => ({ ...prev, project_id: val }))}
              placeholder="Link to project (optional)"
              searchPlaceholder="Search projects..."
            />
          </div>
          {estimatedPrice > 0 && (
            <DiscountFields
              basePrice={estimatedPrice}
              discountType={form.discount_type}
              discountValue={form.discount_value}
              onChange={(type, value) => setForm((prev) => ({ ...prev, discount_type: type, discount_value: value }))}
            />
          )}
          {/* Calculated preview */}
          {estimatedPrice > 0 && (
            <div className="text-xs text-text-sub border-t border-border pt-2">
              Final Price: <span className="font-medium text-text-main">{formatCurrency(finalPrice!)}</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setForm(INITIAL_FORM); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={addItem.isPending}>
              {addItem.isPending ? 'Adding...' : 'Add Commission'}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-text-sub py-4 text-center">Loading...</div>
      ) : items.length === 0 && !showForm ? (
        <EmptyState
          icon={<Briefcase className="h-8 w-8" />}
          title="No commission items"
          description="Add one-time commission work to this accord."
          className="py-8"
        />
      ) : items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-sub">
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">Project</th>
                <th className="pb-2 pr-3 font-medium text-right">Est. Price</th>
                <th className="pb-2 pr-3 font-medium">Discount</th>
                <th className="pb-2 pr-3 font-medium text-right">Final Price</th>
                <th className="pb-2 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: AccordCommissionItem) => {
                const discountLabel = item.discount_type
                  ? item.discount_type === 'percent'
                    ? `${item.discount_value}%`
                    : formatCurrency(item.discount_value || 0)
                  : '--';
                return (
                  <tr key={item.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 text-text-main">
                      {item.name_override || item.ware?.name || 'Unnamed'}
                    </td>
                    <td className="py-2 pr-3 text-text-sub">
                      {item.project ? item.project.name : 'Not linked'}
                    </td>
                    <td className="py-2 pr-3 text-right text-text-sub">
                      {item.estimated_price !== null ? formatCurrency(item.estimated_price) : '--'}
                    </td>
                    <td className="py-2 pr-3 text-text-sub">
                      {discountLabel}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium">
                      {item.final_price !== null ? (
                        <span className="text-text-main">{formatCurrency(item.final_price)}</span>
                      ) : (
                        <Badge variant="warning" size="sm">TBD</Badge>
                      )}
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
                );
              })}
            </tbody>
          </table>

          {/* Subtotals */}
          <div className="mt-3 pt-3 border-t border-border text-sm text-text-sub flex justify-end">
            <span>
              Total: <span className="font-medium text-text-main">{formatCurrency(pricedTotal)}</span>
              {unpricedCount > 0 && (
                <span className="ml-1">+ {unpricedCount} TBD item{unpricedCount > 1 ? 's' : ''}</span>
              )}
            </span>
          </div>
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
