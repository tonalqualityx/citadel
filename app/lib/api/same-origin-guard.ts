import { NextRequest, NextResponse } from 'next/server';

/**
 * Login-CSRF / cross-site defence for portal POSTs that change session state: JSON content type
 * only, and Sec-Fetch-Site / Origin must be same-origin (or the configured app origin). Returns a
 * rejection response, or null when the request may proceed.
 */
export function rejectCrossSiteRequest(request: NextRequest): NextResponse | null {
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return NextResponse.json({ error: 'Unsupported content type.' }, { status: 415 });
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
  }
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl || origin !== new URL(appUrl).origin) {
      return NextResponse.json({ error: 'Forbidden.' }, { status: 403 });
    }
  }
  return null;
}
