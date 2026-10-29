import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { loadBudgetLimits, monthSpend } from '@/lib/design/budget';
import { toUsd } from '@/lib/design/helpers';
import { authActor, requireAdmin, requireSessionVia } from '@/lib/design/route-kit';

// GET /api/design/admin/budgets (design 7.2): every designer (and anyone with a budget row), this month's spend.
export async function GET() {
  try {
    const { actor } = await authActor({ operator: 'setup' });
    requireSessionVia(actor, 'setup');
    requireAdmin(actor);
    const [rows, designers, limits] = await Promise.all([
      prisma.designBudget.findMany(),
      prisma.user.findMany({ where: { role: 'designer', is_active: true }, select: { id: true, name: true } }),
      loadBudgetLimits(),
    ]);
    const byUser = new Map(rows.map((r) => [r.user_id, r]));
    const extraIds = rows.map((r) => r.user_id).filter((id) => !designers.some((d) => d.id === id));
    const extras = extraIds.length ? await prisma.user.findMany({ where: { id: { in: extraIds } }, select: { id: true, name: true } }) : [];
    const users = [...designers, ...extras].sort((a, b) => a.name.localeCompare(b.name));
    const now = new Date();
    const budgets = await Promise.all(
      users.map(async (u) => {
        const row = byUser.get(u.id);
        return {
          user: { id: u.id, name: u.name },
          monthly_cap_usd: row?.monthly_cap_usd != null ? toUsd(row.monthly_cap_usd) : null,
          session_raise_cap_usd: row?.session_raise_cap_usd != null ? toUsd(row.session_raise_cap_usd) : null,
          effective_session_raise_cap_usd: Math.min(row?.session_raise_cap_usd != null ? toUsd(row.session_raise_cap_usd) : limits.designer_raise_cap_usd, limits.hard_session_cap_usd),
          month_spend_usd: toUsd(await monthSpend(u.id, now)),
        };
      }),
    );
    return NextResponse.json({ budgets });
  } catch (error) {
    return handleApiError(error);
  }
}
