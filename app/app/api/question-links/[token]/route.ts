import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import { LINK_PAGE_HEADERS, inspectAnswerLink, inspectPage, outcomePage, redeemAnswerLink, type LinkOutcome } from '@/lib/tasks/answer-links';

/**
 * A signed one-time answer link from a report page (lib/tasks/answer-links.ts). No session: the signed token is the permission.
 *
 * GET  reads only. A good link shows a page that posts itself back at once, so a tap in a browser records it; a link scanner that only fetches
 *      the URL records nothing. A used, expired, altered or out-of-date link shows why and records nothing.
 * POST records it: the option as Mike's answer, or the question held for a chat. Answers HTML, or JSON when the caller asks for it.
 */
type Ctx = { params: Promise<{ token: string }> };

function wantsJson(request: NextRequest): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

function respond(request: NextRequest, o: LinkOutcome, html: string): NextResponse {
  if (wantsJson(request)) {
    const { status, ...body } = o;
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
  }
  return new NextResponse(html, { status: o.status, headers: LINK_PAGE_HEADERS });
}

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { token } = await params;
    const o = await inspectAnswerLink(token);
    return respond(request, o, inspectPage(o, token));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { token } = await params;
    const o = await redeemAnswerLink(token);
    return respond(request, o, outcomePage(o));
  } catch (error) {
    return handleApiError(error);
  }
}
