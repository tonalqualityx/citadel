'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

/**
 * Pill component for status indicators and field values.
 * Uses high-contrast colors (-800 text on -100 backgrounds) for accessibility.
 */
const pillVariants = cva(
  'inline-flex items-center rounded-full font-medium',
  {
    variants: {
      variant: {
        // Semantic variants
        default: 'bg-slate-100 text-slate-800',
        success: 'bg-green-100 text-green-800',
        warning: 'bg-amber-100 text-amber-800',
        error: 'bg-red-100 text-red-800',
        info: 'bg-blue-100 text-blue-800',
        purple: 'bg-purple-100 text-purple-800',
        // Color variants for scales
        green: 'bg-green-100 text-green-800',
        lime: 'bg-lime-100 text-lime-800',
        amber: 'bg-amber-100 text-amber-800',
        orange: 'bg-orange-100 text-orange-800',
        red: 'bg-red-100 text-red-800',
        // Neutral for inactive/draft states
        muted: 'bg-surface-alt text-text-sub',
      },
      size: {
        sm: 'px-2 py-0.5 text-[10px]',
        default: 'px-2.5 py-0.5 text-xs',
        lg: 'px-3 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface PillProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof pillVariants> {}

function Pill({ className, variant, size, ...props }: PillProps) {
  return (
    <span className={cn(pillVariants({ variant, size }), className)} {...props} />
  );
}

export { Pill, pillVariants };
