'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { PortalButton } from '@/components/portal/ui/button';

interface Hit {
  id: string;
  title: string;
  path: string;
}

// "Another page": a combobox over the site's real pages (GET /api/portal/sites/:id/pages?q=).
// Arrow keys move, Enter picks, Escape closes. A page is sent as a choice, so it can never be invented.
export function PageSearch({
  siteId, onPick, onCancel,
}: {
  siteId: string | null;
  onPick: (id: string, label: string) => void;
  onCancel: () => void;
}) {
  const uid = useId();
  const listId = `${uid}-list`;
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!siteId) return;
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(`/api/portal/sites/${siteId}/pages?q=${encodeURIComponent(q.trim())}`);
        if (!res.ok) throw new Error('bad');
        const body = (await res.json()) as { pages: Hit[] };
        if (!cancelled) {
          setHits(body.pages ?? []);
          setFailed(false);
          setActive(-1);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, siteId]);

  function pick(h: Hit) {
    onPick(h.id, h.title.trim() || h.path);
  }

  return (
    <div className="chat-pagesearch" data-testid="chat-page-search">
      <label htmlFor={`${uid}-input`} className="ps-label">
        Search your pages
      </label>
      <div className="ps-box">
        <Search className="i" aria-hidden="true" focusable="false" />
        <input
          ref={inputRef}
          id={`${uid}-input`}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open && hits.length > 0}
          aria-controls={listId}
          aria-activedescendant={active >= 0 ? `${uid}-opt-${active}` : undefined}
          autoComplete="off"
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setOpen(true);
              setActive((a) => Math.min(hits.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter' && active >= 0 && hits[active]) {
              e.preventDefault();
              pick(hits[active]);
            } else if (e.key === 'Escape') {
              if (open) setOpen(false);
              else onCancel();
            }
          }}
        />
      </div>
      <ul id={listId} role="listbox" aria-label="Pages" className="ps-list" hidden={!open || hits.length === 0}>
        {hits.map((h, i) => (
          <li
            key={h.id}
            id={`${uid}-opt-${i}`}
            role="option"
            aria-selected={i === active}
            data-active={i === active || undefined}
            onMouseDown={(e) => {
              e.preventDefault();
              pick(h);
            }}
          >
            <b>{h.title.trim() || h.path}</b>
            <small>{h.path}</small>
          </li>
        ))}
      </ul>
      <p className="hint" role="status">
        {failed ? 'We could not search your pages. Try again, or describe the page in your message.' : loading ? 'Searching…' : hits.length === 0 ? 'No pages match. You can describe the page in your message.' : ''}
      </p>
      <div className="actions">
        <PortalButton variant="quiet" onClick={onCancel}>
          Back to the choices
        </PortalButton>
      </div>
    </div>
  );
}
