import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { apiRegistry, apiEnums, apiInfo } from '@/lib/api/registry';

export async function GET() {
  try {
    await requireAuth();

    return NextResponse.json({
      info: apiInfo,
      enums: apiEnums,
      endpoints: apiRegistry,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
