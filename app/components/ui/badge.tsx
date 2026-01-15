import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full font-medium border',
  {
    variants: {
      variant: {
        default: 'bg-background-light text-text-main border-border-warm',
        success: 'border-transparent',
        warning: 'border-transparent',
        error: 'border-transparent',
        info: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
        purple: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800',
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

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, size, style, ...props }: BadgeProps) {
  // Use inline styles for theme-aware variants that rely on CSS variables
  const themeStyles: React.CSSProperties = {};

  if (variant === 'success') {
    themeStyles.backgroundColor = 'var(--success-subtle)';
    themeStyles.color = 'var(--success)';
  } else if (variant === 'warning') {
    themeStyles.backgroundColor = 'var(--warning-subtle)';
    themeStyles.color = 'var(--warning)';
  } else if (variant === 'error') {
    themeStyles.backgroundColor = 'var(--error-subtle)';
    themeStyles.color = 'var(--error)';
  }

  return (
    <span
      className={cn(badgeVariants({ variant, size }), className)}
      style={{ ...themeStyles, ...style }}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
