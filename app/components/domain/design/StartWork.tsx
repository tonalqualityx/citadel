'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export const WORK_TITLE_MAX = 120;
export const WORK_DETAIL_MAX = 2000;

export interface StartWorkProps {
  /** Sites the caller may start new work on. */
  sites: Array<{ id: string; name: string }>;
  /** No tasks to open: the control leads the page and carries the one-line hint. */
  prominent?: boolean;
  pending?: boolean;
  onStart: (input: { site_id: string; title: string; detail?: string }) => void;
}

// "Start new work" (Mike, 2026-10-29): begin a session on a site that has no task for it yet. The server makes the
// task on the site's open project and routes to the workspace.
export function StartWork({ sites, prominent = false, pending = false, onStart }: StartWorkProps) {
  const [siteId, setSiteId] = React.useState('');
  const [title, setTitle] = React.useState('');
  const [detail, setDetail] = React.useState('');
  const selected = siteId || (sites.length === 1 ? sites[0].id : '');
  const canStart = !!selected && title.trim().length > 0 && !pending;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canStart) return;
    const d = detail.trim();
    onStart({ site_id: selected, title: title.trim(), ...(d ? { detail: d } : {}) });
  }

  return (
    <section
      aria-label="Start new work"
      data-testid="start-work"
      className={prominent ? 'rounded-lg border-2 border-primary bg-surface p-5' : 'rounded-lg border border-border-warm bg-surface p-4'}
    >
      <h2 className={prominent ? 'text-lg font-semibold text-text-main' : 'text-base font-semibold text-text-main'}>Start new work</h2>
      {prominent && <p className="mt-1 text-sm text-text-sub">Pick a site and describe what needs doing.</p>}
      {sites.length === 0 ? (
        <p className="mt-2 text-sm text-text-sub" data-testid="start-work-none">
          No site is ready for new work yet. A site needs the Designer Portal switched on and an open project.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 space-y-3">
          <div>
            <label htmlFor="start-work-site" className="mb-1 block text-sm font-medium text-text-main">Site</label>
            <select
              id="start-work-site"
              value={selected}
              onChange={(e) => setSiteId(e.target.value)}
              className="block min-h-[44px] w-full rounded-lg border border-border-warm bg-surface px-3 py-2 text-sm text-text-main sm:min-h-0"
            >
              <option value="">Choose a site</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <Input
            id="start-work-title"
            label="What needs doing"
            value={title}
            maxLength={WORK_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Update the footer links"
          />
          <Textarea
            id="start-work-detail"
            label="More detail (optional)"
            value={detail}
            maxLength={WORK_DETAIL_MAX}
            onChange={(e) => setDetail(e.target.value)}
            rows={3}
          />
          <Button type="submit" disabled={!canStart}>{pending ? 'Starting...' : 'Start'}</Button>
        </form>
      )}
    </section>
  );
}
