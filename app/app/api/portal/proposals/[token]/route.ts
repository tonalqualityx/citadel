import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { validateProposalToken, logPortalSession, getClientIp } from '@/lib/services/portal';
import { formatAccordCharterItemResponse, formatAccordCommissionItemResponse, formatAccordKeepItemResponse } from '@/lib/api/formatters';

// GET /api/portal/proposals/:token - View proposal (public, no auth)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const proposal = await validateProposalToken(token);

    if (!proposal) {
      return NextResponse.json(
        { error: 'Proposal not found or link has expired' },
        { status: 404 }
      );
    }

    // Log portal access
    await logPortalSession({
      tokenType: 'proposal',
      entityId: proposal.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
    });

    // Return proposal data (safe for client viewing)
    return NextResponse.json({
      id: proposal.id,
      version: proposal.version,
      content: proposal.content,
      status: proposal.status,
      pricing_snapshot: proposal.pricing_snapshot,
      sent_at: proposal.sent_at,
      client_responded_at: proposal.client_responded_at,
      accord: {
        name: proposal.accord.name,
        client: proposal.accord.client
          ? { name: proposal.accord.client.name }
          : null,
        owner: proposal.accord.owner
          ? { name: proposal.accord.owner.name, email: proposal.accord.owner.email }
          : null,
        charter_items: proposal.accord.charter_items?.map((item: any) => ({
          name: item.name_override || item.ware?.name || 'Item',
          base_price: Number(item.base_price),
          final_price: Number(item.final_price),
          billing_period: item.billing_period,
          duration_months: item.duration_months,
          total_contract_value: Number(item.total_contract_value),
        })),
        commission_items: proposal.accord.commission_items?.map((item: any) => ({
          name: item.name_override || item.ware?.name || 'Item',
          estimated_price: item.estimated_price ? Number(item.estimated_price) : null,
          final_price: item.final_price ? Number(item.final_price) : null,
        })),
        keep_items: proposal.accord.keep_items?.map((item: any) => ({
          site_name: item.site?.name || item.site_name_placeholder || 'Site',
          hosting_final_price: item.hosting_final_price ? Number(item.hosting_final_price) : null,
          maintenance_final_price: item.maintenance_final_price ? Number(item.maintenance_final_price) : null,
          monthly_total: item.monthly_total ? Number(item.monthly_total) : null,
        })),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
