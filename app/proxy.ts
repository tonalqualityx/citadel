import { NextRequest, NextResponse } from 'next/server';
import { ROUTE_HEADER } from '@/lib/auth/lane-scopes';

/** Stamped on page requests so a layout can send a cold open through /api/auth/continue and back. */
const PAGE_HEADER = 'x-citadel-page';

/**
 * Fleet item 6: stamp every API request with the route it is for, so lane-scoped API keys can be
 * checked in authenticateApiKey. Any incoming x-citadel-route is dropped first, so a caller cannot
 * choose the value. Nothing else about the request or the response changes.
 *
 * Silent refresh: a page request gets x-citadel-page (path plus query), with any incoming value
 * dropped first. Nothing else about the request or the response changes.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(PAGE_HEADER);
  // The route header is only ever stamped on API requests below; a client-sent one never reaches a
  // page or any other request.
  headers.delete(ROUTE_HEADER);
  const p = request.nextUrl.pathname;
  if (p === '/api' || p.startsWith('/api/')) {
    headers.set(ROUTE_HEADER, `${request.method} ${request.nextUrl.pathname}`);
  } else {
    headers.set(PAGE_HEADER, `${request.nextUrl.pathname}${request.nextUrl.search}`);
  }
  return NextResponse.next({ request: { headers } });
}

export const config = {
  // API routes, plus every page, including a page path that contains a dot (a dynamic segment can).
  // Skipped: Next internals and the public files the home-screen install needs without a session
  // (manifest, icons, favicon). Those are static, so nothing needs stamping on them.
  matcher: [
    '/api/:path*',
    '/((?!api/|_next/|manifest\\.webmanifest|icons/|apple-icon\\.png|icon\\.png|favicon\\.ico|favicon\\.png).*)',
  ],
};
