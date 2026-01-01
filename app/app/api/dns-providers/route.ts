import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db/prisma';
import { requireAuth, requireRole } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';

const createDnsProviderSchema = z.object({
  name: z.string().min(1).max(100),
});

function formatDnsProviderResponse(provider: any) {
  return {
    id: provider.id,
    name: provider.name,
    is_active: provider.is_active,
    created_at: provider.created_at,
    updated_at: provider.updated_at,
  };
}

export async function GET(request: NextRequest) {
  try {
    await requireAuth();

    const providers = await prisma.dnsProvider.findMany({
      where: { is_active: true },
      orderBy: { name: 'asc' },
    });

    return NextResponse.json({
      providers: providers.map(formatDnsProviderResponse),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth();
    requireRole(auth, ['pm', 'admin']);

    const body = await request.json();
    const data = createDnsProviderSchema.parse(body);

    // Check for duplicate name (case-insensitive)
    const existing = await prisma.dnsProvider.findFirst({
      where: {
        name: { equals: data.name, mode: 'insensitive' },
      },
    });

    if (existing) {
      // If it exists but is inactive, reactivate it
      if (!existing.is_active) {
        const reactivated = await prisma.dnsProvider.update({
          where: { id: existing.id },
          data: { is_active: true, name: data.name }, // Update name to preserve case
        });
        return NextResponse.json(formatDnsProviderResponse(reactivated), { status: 200 });
      }
      // Already exists and active
      return NextResponse.json(formatDnsProviderResponse(existing), { status: 200 });
    }

    const provider = await prisma.dnsProvider.create({
      data: {
        name: data.name,
      },
    });

    return NextResponse.json(formatDnsProviderResponse(provider), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
