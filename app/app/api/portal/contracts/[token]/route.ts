import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { validateContractToken, logPortalSession, getClientIp } from '@/lib/services/portal';

// GET /api/portal/contracts/:token - View contract (public, no auth)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const contract = await validateContractToken(token);

    if (!contract) {
      return NextResponse.json(
        { error: 'Contract not found or link has expired' },
        { status: 404 }
      );
    }

    // Log portal access
    await logPortalSession({
      tokenType: 'contract',
      entityId: contract.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
    });

    // Return contract data (safe for client viewing)
    return NextResponse.json({
      id: contract.id,
      version: contract.version,
      content: contract.content_snapshot || contract.content,
      status: contract.status,
      pricing_snapshot: contract.pricing_snapshot,
      sent_at: contract.sent_at,
      signed_at: contract.signed_at,
      accord: {
        name: contract.accord.name,
        client: contract.accord.client
          ? { name: contract.accord.client.name }
          : null,
        owner: contract.accord.owner
          ? { name: contract.accord.owner.name, email: contract.accord.owner.email }
          : null,
        charter_items: contract.accord.charter_items?.map((item: any) => ({
          name: item.name_override || item.ware?.name || 'Item',
          final_price: Number(item.final_price),
          billing_period: item.billing_period,
          duration_months: item.duration_months,
          total_contract_value: Number(item.total_contract_value),
        })),
        commission_items: contract.accord.commission_items?.map((item: any) => ({
          name: item.name_override || item.ware?.name || 'Item',
          type: item.ware?.type || null,
          final_price: item.final_price ? Number(item.final_price) : null,
        })),
        keep_items: contract.accord.keep_items?.map((item: any) => ({
          site_name: item.site?.name || item.site_name_placeholder || 'Site',
          hosting_final_price: item.hosting_final_price ? Number(item.hosting_final_price) : null,
          maintenance_final_price: item.maintenance_final_price ? Number(item.maintenance_final_price) : null,
          monthly_total: item.monthly_total ? Number(item.monthly_total) : null,
        })),
      },
      msa_version: contract.msa_version
        ? { version: contract.msa_version.version }
        : null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
