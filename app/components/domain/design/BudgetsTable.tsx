'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { useAdminBudgets, useUpdateBudget, type AdminBudget } from '@/lib/hooks/use-design-admin';

/** Blank clears the cap (null); otherwise a non-negative number. undefined = invalid. */
export function parseCap(value: string): number | null | undefined {
  if (value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function BudgetRow({ b, canWrite }: { b: AdminBudget; canWrite: boolean }) {
  const update = useUpdateBudget();
  const [monthly, setMonthly] = React.useState(b.monthly_cap_usd === null ? '' : String(b.monthly_cap_usd));
  const [raise, setRaise] = React.useState(b.session_raise_cap_usd === null ? '' : String(b.session_raise_cap_usd));
  const m = parseCap(monthly);
  const r = parseCap(raise);
  const invalid = m === undefined || r === undefined;
  return (
    <tr className="border-b border-border-warm last:border-0 align-top">
      <th scope="row" className="px-3 py-2 text-left font-medium text-text-main">{b.user.name}</th>
      <td className="px-3 py-2 text-text-sub">${b.month_spend_usd.toFixed(2)}</td>
      <td className="px-3 py-2">
        <Input aria-label={`Monthly cap for ${b.user.name}`} type="number" min={0} step="any" placeholder="Default" value={monthly} onChange={(e) => setMonthly(e.target.value)} readOnly={!canWrite} />
      </td>
      <td className="px-3 py-2">
        <Input aria-label={`Raise cap for ${b.user.name}`} type="number" min={0} step="any" placeholder={`Default ($${b.effective_session_raise_cap_usd})`} value={raise} onChange={(e) => setRaise(e.target.value)} readOnly={!canWrite} />
      </td>
      <td className="px-3 py-2">
        {canWrite && (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={invalid || update.isPending}
            onClick={() => update.mutate({ userId: b.user.id, monthly_cap_usd: m as number | null, session_raise_cap_usd: r as number | null })}
          >
            Save
          </Button>
        )}
      </td>
    </tr>
  );
}

export function BudgetsTable({ canWrite }: { canWrite: boolean }) {
  const { data, isLoading, error } = useAdminBudgets(canWrite);
  if (!canWrite) return <p className="text-sm text-text-sub">Only an admin can see the budgets.</p>;
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-text-sub">The budgets could not be loaded.</p>;
  if (data.budgets.length === 0) return <p className="text-sm text-text-sub">No designers yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-border-warm bg-surface">
      <table className="w-full min-w-[40rem] text-sm">
        <thead>
          <tr className="border-b border-border-warm text-left text-xs text-text-sub">
            <th scope="col" className="px-3 py-2 font-medium">Designer</th>
            <th scope="col" className="px-3 py-2 font-medium">This month</th>
            <th scope="col" className="px-3 py-2 font-medium">Monthly cap (USD)</th>
            <th scope="col" className="px-3 py-2 font-medium">Raise cap (USD)</th>
            <th scope="col" className="px-3 py-2"><span className="sr-only">Save</span></th>
          </tr>
        </thead>
        <tbody>{data.budgets.map((b) => <BudgetRow key={b.user.id} b={b} canWrite={canWrite} />)}</tbody>
      </table>
    </div>
  );
}
