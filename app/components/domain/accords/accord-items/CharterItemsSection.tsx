'use client';

import * as React from 'react';
import { RotateCcw, Plus, Trash2 } from 'lucide-react';
import { CollapsibleSection } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { EmptyState } from '@/components/ui/empty-state';
import { DiscountFields } from './DiscountFields';
import { useAccordCharterItems, useAddAccordCharterItem, useDeleteAccordCharterItem } from '@/lib/hooks/use-accord-items';
import { useWares } from '@/lib/hooks/use-wares';
import { showToast } from '@/lib/hooks/use-toast';
import type { AccordCharterItem } from '@/types/entities';

interface CharterItemsSectionProps {
  accordId: string;
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
  price_tier: '',
  base_price: '',
  billing_period: 'monthly' as 'monthly' | 'annually',
  duration_months: '12',
  discount_type: null as 'percent' | 'flat' | null,
  discount_value: null as number | null,
  contract_language_override: '',
};

export function CharterItemsSection({ accordId }: CharterItemsSectionProps) {
  const [showForm, setShowForm] = React.useState(false);
  const [form, setForm] = React.useState(INITIAL_FORM);

  const { data: items = [], isLoading } = useAccordCharterItems(accordId);
  const { data: waresData } = useWares({ type: 'charter', is_active: true, limit: 100 });
  const addItem = useAddAccordCharterItem();
  const deleteItem = useDeleteAccordCharterItem();

  const wares = waresData?.wares || [];
  const wareOptions = wares.map((w) => ({ value: w.id, label: w.name, description: w.base_price ? formatCurrency(w.base_price) : undefined }));

  const selectedWare = wares.find((w) => w.id === form.ware_id);

  // Auto-fill base price from ware when selected
  React.useEffect(() => {
    if (selectedWare?.base_price && !form.base_price) {
      setForm((prev) => ({ ...prev, base_price: selectedWare.base_price!.toString() }));
    }
    if (selectedWare?.charter_billing_period) {
      setForm((prev) => ({ ...prev, billing_period: selectedWare.charter_billing_period! }));
    }
  }, [selectedWare]);

  const basePrice = parseFloat(form.base_price) || 0;
  const finalPrice = calculateFinalPrice(basePrice, form.discount_type, form.discount_value);
  const durationMonths = parseInt(form.duration_months) || 0;
  const monthlyPrice = form.billing_period === 'annually' ? finalPrice / 12 : finalPrice;
  const totalContractValue = monthlyPrice * durationMonths;

  const handleSubmit = () => {
    if (!form.ware_id || !form.base_price) {
      showToast.error('Ware and base price are required');
      return;
    }

    addItem.mutate(
      {
        accordId,
        data: {
          ware_id: form.ware_id,
          base_price: basePrice,
          billing_period: form.billing_period,
          duration_months: durationMonths,
          price_tier: form.price_tier || undefined,
          discount_type: form.discount_type,
          discount_value: form.discount_value,
          contract_language_override: form.contract_language_override || null,
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
  const monthlySubtotal = items.reduce((sum: number, item: AccordCharterItem) => {
    const mp = item.billing_period === 'annually' ? item.final_price / 12 : item.final_price;
    return sum + mp;
  }, 0);
  const contractTotal = items.reduce((sum: number, item: AccordCharterItem) => sum + item.total_contract_value, 0);

  const billingPeriodLabel = form.billing_period === 'annually' ? 'yr' : 'mo';

  return (
    <CollapsibleSection
      title="Charters"
      icon={<RotateCcw className="h-4 w-4 text-text-sub" />}
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
              onChange={(val) => setForm((prev) => ({ ...prev, ware_id: val, base_price: '' }))}
              placeholder="Select charter ware..."
              searchPlaceholder="Search wares..."
            />
            <Input
              label="Price Tier"
              value={form.price_tier}
              onChange={(e) => setForm((prev) => ({ ...prev, price_tier: e.target.value }))}
              placeholder="e.g. Standard, Premium"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <Input
              label="Base Price"
              type="number"
              step="0.01"
              min="0"
              value={form.base_price}
              onChange={(e) => setForm((prev) => ({ ...prev, base_price: e.target.value }))}
              placeholder="0.00"
            />
            <Select
              label="Billing Period"
              value={form.billing_period}
              onChange={(val) => setForm((prev) => ({ ...prev, billing_period: val as 'monthly' | 'annually' }))}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'annually', label: 'Annually' },
              ]}
            />
            <Input
              label="Duration (months)"
              type="number"
              min="1"
              value={form.duration_months}
              onChange={(e) => setForm((prev) => ({ ...prev, duration_months: e.target.value }))}
            />
          </div>
          <DiscountFields
            basePrice={basePrice}
            discountType={form.discount_type}
            discountValue={form.discount_value}
            onChange={(type, value) => setForm((prev) => ({ ...prev, discount_type: type, discount_value: value }))}
            billingPeriodLabel={billingPeriodLabel}
          />
          <Input
            label="Contract Language Override"
            value={form.contract_language_override}
            onChange={(e) => setForm((prev) => ({ ...prev, contract_language_override: e.target.value }))}
            placeholder="Optional override..."
          />
          {/* Calculated preview */}
          {basePrice > 0 && (
            <div className="text-xs text-text-sub border-t border-border pt-2">
              Final: <span className="font-medium text-text-main">{formatCurrency(finalPrice)}/{billingPeriodLabel}</span>
              {' | '}
              Contract Value: <span className="font-medium text-text-main">{formatCurrency(totalContractValue)}</span>
              <span className="text-text-sub"> ({durationMonths} months)</span>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => { setShowForm(false); setForm(INITIAL_FORM); }}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={addItem.isPending}>
              {addItem.isPending ? 'Adding...' : 'Add Charter'}
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      {isLoading ? (
        <div className="text-sm text-text-sub py-4 text-center">Loading...</div>
      ) : items.length === 0 && !showForm ? (
        <EmptyState
          icon={<RotateCcw className="h-8 w-8" />}
          title="No charter items"
          description="Add recurring charter services to this accord."
          className="py-8"
        />
      ) : items.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-text-sub">
                <th className="pb-2 pr-3 font-medium">Name</th>
                <th className="pb-2 pr-3 font-medium">Tier</th>
                <th className="pb-2 pr-3 font-medium text-right">Base Price</th>
                <th className="pb-2 pr-3 font-medium">Discount</th>
                <th className="pb-2 pr-3 font-medium text-right">Price/Period</th>
                <th className="pb-2 pr-3 font-medium text-right">Duration</th>
                <th className="pb-2 pr-3 font-medium text-right">Contract Value</th>
                <th className="pb-2 font-medium w-10"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item: AccordCharterItem) => {
                const periodLabel = item.billing_period === 'annually' ? 'yr' : 'mo';
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
                      {item.price_tier || '--'}
                    </td>
                    <td className="py-2 pr-3 text-right text-text-sub">
                      {formatCurrency(item.base_price)}
                    </td>
                    <td className="py-2 pr-3 text-text-sub">
                      {discountLabel}
                    </td>
                    <td className="py-2 pr-3 text-right font-medium text-text-main">
                      {formatCurrency(item.final_price)}/{periodLabel}
                    </td>
                    <td className="py-2 pr-3 text-right text-text-sub">
                      {item.duration_months}mo
                    </td>
                    <td className="py-2 pr-3 text-right font-medium text-text-main">
                      {formatCurrency(item.total_contract_value)}
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
          <div className="mt-3 pt-3 border-t border-border text-sm text-text-sub flex justify-end gap-4">
            <span>Monthly: <span className="font-medium text-text-main">{formatCurrency(monthlySubtotal)}/mo</span></span>
            <span>Contract Total: <span className="font-medium text-text-main">{formatCurrency(contractTotal)}</span></span>
          </div>
        </div>
      ) : null}
    </CollapsibleSection>
  );
}
