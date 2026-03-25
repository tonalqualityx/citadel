import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { handleApiError, ApiError } from '@/lib/api/errors';
import { logPortalSession, getClientIp } from '@/lib/services/portal';

// GET /api/portal/onboard/:token - View onboarding info (public, no auth)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Look up the contract by portal token to find the accord
    const contract = await prisma.contract.findFirst({
      where: {
        portal_token: token,
        status: 'signed',
        is_deleted: false,
      },
      include: {
        accord: {
          select: {
            id: true,
            name: true,
            lead_name: true,
            lead_business_name: true,
            lead_email: true,
            lead_phone: true,
            client_id: true,
          },
        },
      },
    });

    if (!contract) {
      return NextResponse.json(
        { error: 'Onboarding link not found or not ready' },
        { status: 404 }
      );
    }

    // If accord already has a client, onboarding is complete
    if (contract.accord.client_id) {
      return NextResponse.json({
        already_onboarded: true,
        accord_name: contract.accord.name,
      });
    }

    await logPortalSession({
      tokenType: 'contract',
      entityId: contract.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'view',
      metadata: { context: 'onboarding' },
    });

    return NextResponse.json({
      accord_name: contract.accord.name,
      lead_name: contract.accord.lead_name,
      lead_business_name: contract.accord.lead_business_name,
      lead_email: contract.accord.lead_email,
      lead_phone: contract.accord.lead_phone,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

const onboardSchema = z.object({
  name: z.string().min(1, 'Business name is required'),
  primary_contact: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
});

// POST /api/portal/onboard/:token - Submit onboarding info (public, no auth)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    const contract = await prisma.contract.findFirst({
      where: {
        portal_token: token,
        status: 'signed',
        is_deleted: false,
      },
      include: {
        accord: {
          select: {
            id: true,
            name: true,
            client_id: true,
            lead_email: true,
            lead_phone: true,
          },
        },
      },
    });

    if (!contract) {
      return NextResponse.json(
        { error: 'Onboarding link not found or not ready' },
        { status: 404 }
      );
    }

    if (contract.accord.client_id) {
      throw new ApiError('Onboarding has already been completed for this accord', 400);
    }

    const body = await request.json();
    const data = onboardSchema.parse(body);

    // Create client from onboarding info
    const client = await prisma.client.create({
      data: {
        name: data.name,
        primary_contact: data.primary_contact || null,
        email: data.email || contract.accord.lead_email || null,
        phone: data.phone || contract.accord.lead_phone || null,
        type: 'direct',
        status: 'active',
      },
    });

    // Link client to accord
    await prisma.accord.update({
      where: { id: contract.accord.id },
      data: { client_id: client.id },
    });

    await logPortalSession({
      tokenType: 'contract',
      entityId: contract.id,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get('user-agent'),
      action: 'sign',
      metadata: { context: 'onboarding', client_id: client.id },
    });

    return NextResponse.json({
      message: 'Onboarding complete',
      client_id: client.id,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
