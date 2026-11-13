'use client';

import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

const DrawerTrigger = DialogPrimitive.Trigger;
const DrawerClose = DialogPrimitive.Close;
const DrawerPortal = DialogPrimitive.Portal;

const DrawerOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-50 bg-black/30 pointer-events-none',
      'data-[state=open]:animate-in data-[state=closed]:animate-out',
      'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
));
DrawerOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Non-modal drawer that allows interaction with content behind it
function Drawer(props: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root modal={false} {...props} />;
}

interface DrawerContentProps
  extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: 'left' | 'right';
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

const DrawerContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DrawerContentProps
>(({ className, children, side = 'right', size = 'md', ...props }, ref) => {
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      contentRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
    },
    [ref]
  );

  // The content stays mounted while closed (forceMount), so Radix's outside-press listener is always live. On touch it
  // waits for the click that ends a tap, and the tap that OPENS the drawer is that same tap: the drawer opens on the
  // click, then Radix reads the same tap as "pressed outside" and closes it. Note which presses began while the drawer
  // was not open, and ignore those. (Capture phase, so it runs before Radix's own listener.)
  const pressesBeganClosed = React.useRef<WeakSet<Event>>(new WeakSet());
  React.useEffect(() => {
    const note = (e: Event) => {
      if (contentRef.current?.getAttribute('data-state') !== 'open') pressesBeganClosed.current.add(e);
    };
    document.addEventListener('pointerdown', note, true);
    return () => document.removeEventListener('pointerdown', note, true);
  }, []);

  return (
  <DrawerPortal forceMount>
    <DialogPrimitive.Content
      ref={setRefs}
      forceMount
      onInteractOutside={(e) => {
        if (pressesBeganClosed.current.has(e.detail.originalEvent)) {
          e.preventDefault();
          return;
        }
        // Check if clicking on a task row - if so, don't close (let task click handler work)
        const target = e.target as HTMLElement;
        if (target.closest('[data-task-row]')) {
          e.preventDefault();
        }
      }}
      className={cn(
        'fixed z-50 h-full bg-surface shadow-2xl flex flex-col pointer-events-auto',
        'shadow-black/25',
        // Right side
        side === 'right' && 'right-0 top-0 border-l border-border drawer-content-right',
        // Left side
        side === 'left' && 'left-0 top-0 border-r border-border drawer-content-left',
        // Sizes
        {
          'w-[min(90vw,300px)]': size === 'sm',
          'w-[min(90vw,400px)]': size === 'md',
          'w-[min(90vw,500px)]': size === 'lg',
          'w-[min(90vw,600px)]': size === 'xl',
        },
        className
      )}
      {...props}
    >
      {/* Visually hidden description for accessibility */}
      <DialogPrimitive.Description className="sr-only">
        Side panel
      </DialogPrimitive.Description>
      {children}
    </DialogPrimitive.Content>
  </DrawerPortal>
  );
});
DrawerContent.displayName = DialogPrimitive.Content.displayName;

const DrawerHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex items-center justify-between p-4 border-b border-border-warm',
      className
    )}
    {...props}
  />
);
DrawerHeader.displayName = 'DrawerHeader';

const DrawerTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('text-lg font-semibold text-text-main', className)}
    {...props}
  />
));
DrawerTitle.displayName = DialogPrimitive.Title.displayName;

const DrawerDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-sm text-text-sub', className)}
    {...props}
  />
));
DrawerDescription.displayName = DialogPrimitive.Description.displayName;

const DrawerBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex-1 overflow-y-auto p-4', className)} {...props} />
);
DrawerBody.displayName = 'DrawerBody';

const DrawerFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      'flex items-center justify-end gap-2 p-4 border-t border-border-warm',
      className
    )}
    {...props}
  />
);
DrawerFooter.displayName = 'DrawerFooter';

const DrawerCloseButton = () => (
  <DialogPrimitive.Close className="rounded-sm opacity-70 ring-offset-surface transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:pointer-events-none">
    <X className="h-5 w-5" />
    <span className="sr-only">Close</span>
  </DialogPrimitive.Close>
);

export {
  Drawer,
  DrawerPortal,
  DrawerOverlay,
  DrawerTrigger,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerFooter,
  DrawerTitle,
  DrawerDescription,
  DrawerBody,
  DrawerCloseButton,
};
