import { NextRequest, NextResponse } from 'next/server';
import { ROUTE_HEADER } from '@/lib/auth/lane-scopes';

/**
 * Fleet item 6: stamp every API request with the route it is for, so lane-scoped API keys can be
 * checked in authenticateApiKey. Any incoming x-citadel-route is dropped first, so a caller cannot
 * choose the value. Nothing else about the request or the response changes.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(ROUTE_HEADER);
  headers.set(ROUTE_HEADER, `${request.method} ${request.nextUrl.pathname}`);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/api/:path*'],
};
