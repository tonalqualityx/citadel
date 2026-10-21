import { NextRequest, NextResponse } from 'next/server';

// GET /api/portal/login/:token
// Legacy entry point for magic links. It NEVER consumes anything: it only redirects to the
// /portal/login/verify interstitial, where a person presses one button that POSTs to
// /api/portal/login/consume. That keeps mail scanners and link previewers (which GET every link)
// from burning a single-use token. Links now go straight to the interstitial; this route exists
// so any older link still lands on a real page.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  return NextResponse.redirect(
    `${baseUrl}/portal/login/verify#token=${encodeURIComponent(token)}`,
    303
  );
}
