import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db/prisma';
import { handleApiError } from '@/lib/api/errors';
import { logPortalSession, getClientIp } from '@/lib/services/portal';

// Inline token validation for public route
async function validateAddendumToken(token: string) {
  const addendum = await prisma.addendum.findFirst({
    where: {
      portal_token: token,
      is_deleted: false,
    },
    include: {
      accord: {
        include: {
          client: { select: { id: true, name: true } },
          owner: { select: { id: true, name: true, email: true } },
          charter_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          commission_items: {
            where: { is_deleted: false },
            include: { ware: { select: { id: true, name: true, type: true } } },
            orderBy: { sort_order: 'asc' },
          },
          keep_items: {
            where: { is_deleted: false },
            include: {
              site: { select: { id: true, name: true, url: true } },
              hosting_plan: { select: { id: true, name: true, rate: true } },
              maintenance_plan: { select: { id: true, name: true, rate: true } },
            },
            orderBy: { sort_order: 'asc' },
          },
        },
      },
      created_by: { select: { id: true, name: true, email: true } },
      charter_items: {
        where: { is_deleted: false },
        include: { ware: { select: { id: true, name: true, type: true } } },
        orderBy: { sort_order: 'asc' },
      },
      commission_items: {
        where: { is_deleted: false },
        include: { ware: { select: { id: true, name: true, type: true } } },
        orderBy: { sort_order: 'asc' },
      },
      keep_items: {
        where: { is_deleted: false },
        include: {
          site: { select: { id: true, name: true, url: true } },
          hosting_plan: { select: { id: true, name: true, rate: true } },
          maintenance_plan: { select: { id: true, name: true, rate: true } },
        },
        orderBy: { sort_order: 'asc' },
      },
    },
  });

  if (!addendum) return null;

  // Check expiry
  if (addendum.portal_token_expires_at && addendum.portal_token_expires_at < new Date()) {
    return null;
  }

  return addendum;
}

// GET /api/portal/addendums/:token - View addendum (public, no auth)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    const addendum = await validateAddendumToken(token);

    if (!addendum) {
      return NextResponse.json(
        { error: 'Addendum not found or link has expired' },
        { status: 404 }
      );
    }

    // Log portal access
    await logPortalSession({
      tokenType: 'addendum' as any,
      entityId: addendum.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
    });

    // Return addendum data (safe for client viewing)
    return NextResponse.json({
      id: addendum.id,
      version: addendum.version,
      title: addendum.title,
      description: addendum.description,
      contract_content: addendum.content_snapshot || addendum.contract_content,
      status: addendum.status,
      pricing_snapshot: addendum.pricing_snapshot,
      changes: addendum.changes,
      sent_at: addendum.sent_at,
      client_responded_at: addendum.client_responded_at,
      accord: {
        name: addendum.accord.name,
        client: addendum.accord.client
          ? { name: addendum.accord.client.name }
          : null,
        owner: addendum.accord.owner
          ? { name: addendum.accord.owner.name, email: addendum.accord.owner.email }
          : null,
        charter_items: addendum.accord.charter_items?.map((item: any) => ({
          name: item.name_override || item.ware?.name || 'Item',
          final_price: Number(item.final_price),
          billing_period: item.billing_period,
          total_contract_value: Number(item.total_contract_value),
        })),
        commission_items: addendum.accord.commission_items?.map((item: any) => ({
          name: item.name_override || item.ware?.name || 'Item',
          final_price: item.final_price ? Number(item.final_price) : null,
        })),
        keep_items: addendum.accord.keep_items?.map((item: any) => ({
          site_name: item.site?.name || item.site_name_placeholder || 'Site',
          monthly_total: item.monthly_total ? Number(item.monthly_total) : null,
        })),
      },
      // Addendum-specific items (changes being proposed)
      charter_items: addendum.charter_items?.map((item: any) => ({
        name: item.name_override || item.ware?.name || 'Item',
        final_price: Number(item.final_price),
        billing_period: item.billing_period,
        total_contract_value: Number(item.total_contract_value),
      })),
      commission_items: addendum.commission_items?.map((item: any) => ({
        name: item.name_override || item.ware?.name || 'Item',
        final_price: item.final_price ? Number(item.final_price) : null,
      })),
      keep_items: addendum.keep_items?.map((item: any) => ({
        site_name: item.site?.name || item.site_name_placeholder || 'Site',
        monthly_total: item.monthly_total ? Number(item.monthly_total) : null,
      })),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
