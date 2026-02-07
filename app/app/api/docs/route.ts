import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { handleApiError } from '@/lib/api/errors';
import { apiRegistry, apiEnums, apiInfo } from '@/lib/api/registry';

export async function GET(request: NextRequest) {
  try {
    await requireAuth();
    const { searchParams } = new URL(request.url);
    const group = searchParams.get('group');

    if (group) {
      // Tier 2: Full detail for one domain group
      const endpoints = apiRegistry.filter(e => e.group === group);
      return NextResponse.json({
        info: apiInfo,
        enums: apiEnums,
        endpoints,
      });
    }

    // Tier 1: Summary of all endpoints (no response shapes, no param details)
    const summary = apiRegistry.map(e => ({
      path: e.path,
      group: e.group,
      methods: e.methods.map(m => ({
        method: m.method,
        summary: m.summary,
        auth: m.auth,
        roles: m.roles,
      })),
    }));

    const availableGroups = [...new Set(apiRegistry.map(e => e.group).filter(Boolean))];

    return NextResponse.json({
      info: apiInfo,
      enums: apiEnums,
      availableGroups,
      endpoints: summary,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
