'use client';

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface CollapsibleProps {
  /** Whether the collapsible is open (controlled) */
  open?: boolean;
  /** Default open state (uncontrolled) */
  defaultOpen?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
  /** Custom trigger element - if not provided, uses children as content only */
  trigger?: React.ReactNode;
  /** Content to show when expanded */
  children: React.ReactNode;
  /** Additional class name for the container */
  className?: string;
}

/**
 * Simple collapsible component with smooth height animation
 */
export function Collapsible({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  trigger,
  children,
  className,
}: CollapsibleProps) {
  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | 'auto'>(defaultOpen ? 'auto' : 0);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : internalOpen;

  const handleToggle = () => {
    const newOpen = !isOpen;
    if (!isControlled) {
      setInternalOpen(newOpen);
    }
    onOpenChange?.(newOpen);
  };

  // Update height on open/close
  React.useEffect(() => {
    if (!contentRef.current) return;

    if (isOpen) {
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      // After animation, set to auto for dynamic content
      const timer = setTimeout(() => setHeight('auto'), 200);
      return () => clearTimeout(timer);
    } else {
      // First set explicit height, then animate to 0
      if (height === 'auto') {
        setHeight(contentRef.current.scrollHeight);
        requestAnimationFrame(() => {
          setHeight(0);
        });
      } else {
        setHeight(0);
      }
    }
  }, [isOpen]);

  return (
    <div className={className}>
      {trigger && (
        <button
          type="button"
          onClick={handleToggle}
          className="w-full text-left"
        >
          {trigger}
        </button>
      )}
      <div
        ref={contentRef}
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
        className={cn(
          'overflow-hidden transition-[height] duration-200 ease-in-out',
          !isOpen && 'pointer-events-none'
        )}
      >
        {children}
      </div>
    </div>
  );
}

interface CollapsibleSectionProps {
  /** Title displayed in the header */
  title: React.ReactNode;
  /** Optional icon displayed before title */
  icon?: React.ReactNode;
  /** Optional badge/count displayed after title */
  badge?: React.ReactNode;
  /** Optional actions on the right side of header */
  actions?: React.ReactNode;
  /** Default open state */
  defaultOpen?: boolean;
  /** Content to show when expanded */
  children: React.ReactNode;
  /** Additional class name */
  className?: string;
  /** Header class name */
  headerClassName?: string;
  /** Content class name */
  contentClassName?: string;
}

/**
 * Styled collapsible section with header, icon, and actions
 */
export function CollapsibleSection({
  title,
  icon,
  badge,
  actions,
  defaultOpen = true,
  children,
  className,
  headerClassName,
  contentClassName,
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState<number | 'auto'>(defaultOpen ? 'auto' : 0);

  React.useEffect(() => {
    if (!contentRef.current) return;

    if (isOpen) {
      const contentHeight = contentRef.current.scrollHeight;
      setHeight(contentHeight);
      const timer = setTimeout(() => setHeight('auto'), 200);
      return () => clearTimeout(timer);
    } else {
      if (height === 'auto') {
        setHeight(contentRef.current.scrollHeight);
        requestAnimationFrame(() => {
          setHeight(0);
        });
      } else {
        setHeight(0);
      }
    }
  }, [isOpen]);

  return (
    <div className={cn('border border-border rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2 bg-surface-alt cursor-pointer select-none',
          'hover:bg-surface-alt/80 transition-colors',
          headerClassName
        )}
        onClick={() => setIsOpen(!isOpen)}
      >
        <ChevronDown
          className={cn(
            'h-4 w-4 text-text-sub transition-transform duration-200 flex-shrink-0',
            isOpen && 'rotate-180'
          )}
        />
        {icon && <span className="flex-shrink-0">{icon}</span>}
        <span className="flex-1 font-medium text-sm text-text-main truncate">
          {title}
        </span>
        {badge && <span className="flex-shrink-0">{badge}</span>}
        {actions && (
          <div
            className="flex items-center gap-1 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>

      {/* Content */}
      <div
        ref={contentRef}
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
        className={cn(
          'overflow-hidden transition-[height] duration-200 ease-in-out',
          !isOpen && 'pointer-events-none'
        )}
      >
        <div className={cn('p-3', contentClassName)}>{children}</div>
      </div>
    </div>
  );
}
