'use client';

import { useState } from 'react';
import { Check, FileText } from 'lucide-react';
import { Callout } from '@/components/portal/ui/callout';
import { PortalButton } from '@/components/portal/ui/button';

export interface PlanReady {
  task_id: string;
  title: string;
  preview_url: string;
  book_href: string;
}

const BOOK = '/portal/book?type=marketing';

// "Your {month} plan is ready": open the plan, approve it here, or book a meeting. Approving
// here or by email both count; the approve endpoint is the existing one.
export function PlanApprovalBlock({ plan, monthName, onChanged }: { plan: PlanReady; monthName: string | null; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function approve() {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/portal/tasks/mine/${plan.task_id}/approve`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setErr(body.error || 'Something went wrong. Please try again.');
        return;
      }
      onChanged();
    } catch {
      setErr('Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Callout
      id="plan-ready"
      icon={FileText}
      title={monthName ? `Your ${monthName} plan is ready` : 'Your plan is ready'}
      note="Read it, then approve it or book a call to talk it through. Approving here or by email both count."
    >
      <p className="note">{plan.title}</p>
      <div className="actions plan-actions">
        <a className="btn btn-secondary" href={plan.preview_url} target="_blank" rel="noopener noreferrer">
          <FileText className="i" aria-hidden="true" focusable="false" />
          Open the plan
        </a>
        <PortalButton variant="primary" icon={Check} busy={busy} busyLabel="Approving…" onClick={approve}>
          Approve the plan
        </PortalButton>
        <PortalButton variant="quiet" href={plan.book_href || BOOK}>
          Book a meeting
        </PortalButton>
      </div>
      {err ? (
        <p role="alert" className="note plan-err">
          {err}
        </p>
      ) : null}
    </Callout>
  );
}
