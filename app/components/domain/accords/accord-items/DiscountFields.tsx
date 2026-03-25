'use client';

import * as React from 'react';
import { Select } from '@/components/ui/select';
import { Input } from '@/components/ui/input';

interface DiscountFieldsProps {
  basePrice: number;
  discountType: 'percent' | 'flat' | null;
  discountValue: number | null;
  onChange: (type: 'percent' | 'flat' | null, value: number | null) => void;
  billingPeriodLabel?: string;
}

function calculateFinalPrice(basePrice: number, discountType: string | null, discountValue: number | null): number {
  if (!discountType || !discountValue) return basePrice;
  if (discountType === 'percent') return Math.max(0, basePrice * (1 - discountValue / 100));
  if (discountType === 'flat') return Math.max(0, basePrice - discountValue);
  return basePrice;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(value);
}

export function DiscountFields({ basePrice, discountType, discountValue, onChange, billingPeriodLabel }: DiscountFieldsProps) {
  const finalPrice = calculateFinalPrice(basePrice, discountType, discountValue);
  const suffix = billingPeriodLabel ? `/${billingPeriodLabel}` : '';

  const discountOptions = [
    { value: 'none', label: 'No Discount' },
    { value: 'percent', label: 'Percentage' },
    { value: 'flat', label: 'Flat Amount' },
  ];

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3">
        <Select
          label="Discount"
          value={discountType || 'none'}
          onChange={(val) => {
            if (val === 'none') {
              onChange(null, null);
            } else {
              onChange(val as 'percent' | 'flat', discountValue || 0);
            }
          }}
          options={discountOptions}
        />
        {discountType && (
          <Input
            label={discountType === 'percent' ? 'Discount %' : 'Discount $'}
            type="number"
            step={discountType === 'percent' ? '1' : '0.01'}
            min="0"
            max={discountType === 'percent' ? '100' : undefined}
            value={discountValue?.toString() || ''}
            onChange={(e) => onChange(discountType, parseFloat(e.target.value) || 0)}
          />
        )}
      </div>
      {discountType && discountValue ? (
        <div className="text-xs text-text-sub">
          {formatCurrency(basePrice)} - {discountType === 'percent' ? `${discountValue}%` : formatCurrency(discountValue)} = <span className="font-medium text-text-main">{formatCurrency(finalPrice)}{suffix}</span>
        </div>
      ) : null}
    </div>
  );
}
