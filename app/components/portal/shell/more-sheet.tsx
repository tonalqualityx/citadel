'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import { History, LogOut, Users, Video } from 'lucide-react';
import { HelpLine } from './help-line';
import { ThemeControl } from './theme-control';

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The phone's More sheet: a modal dialog. Escape and the backdrop close it; focus goes in and comes back. */
export function MoreSheet({
  open, onClose, canSwitch, onSignOut, returnFocusTo,
}: {
  open: boolean;
  onClose: () => void;
  canSwitch: boolean;
  onSignOut: () => void;
  returnFocusTo: React.RefObject<HTMLElement | null>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const el = ref.current;
    el?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const target = returnFocusTo.current;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      target?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-back" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="More" ref={ref} data-nav-zone="false">
        <span className="grab" aria-hidden="true" />
        <Link href="/portal/history" onClick={onClose}>
          <History className="i" aria-hidden="true" focusable="false" />
          History
        </Link>
        <Link href="/portal/book" onClick={onClose}>
          <Video className="i" aria-hidden="true" focusable="false" />
          Book a meeting
        </Link>
        {canSwitch ? (
          <Link href="/portal/select" onClick={onClose}>
            <Users className="i" aria-hidden="true" focusable="false" />
            Switch account
          </Link>
        ) : null}
        <div className="row-theme">
          <ThemeControl />
        </div>
        <button type="button" className="row" onClick={onSignOut}>
          <LogOut className="i" aria-hidden="true" focusable="false" />
          Sign out
        </button>
        <HelpLine />
      </div>
    </>
  );
}
