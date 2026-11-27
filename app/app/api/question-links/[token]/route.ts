import { NextRequest, NextResponse } from 'next/server';
import { handleApiError } from '@/lib/api/errors';
import {
  FOREIGN_ORIGIN,
  LINK_PAGE_HEADERS,
  corsHeadersFor,
  inspectAnswerLink,
  inspectPage,
  outcomePage,
  postOriginAllowed,
  redeemAnswerLink,
  type LinkOutcome,
} from '@/lib/tasks/answer-links';

/**
 * A signed one-time answer link from a report page (lib/tasks/answer-links.ts). No session: the signed token is the permission.
 *
 * GET     reads only. A good link shows a page that posts itself back at once, so a tap in a browser records it; a link scanner that only fetches
 *         the URL records nothing. A used, expired, altered or out-of-date link shows why and records nothing. Asked for JSON, it also says whether
 *         this link's choice is the question's current state (`selected`), which the report page reads to show earlier answers as picked.
 * POST    records it: the option as Mike's answer, or the question held for a chat. Answers HTML, or JSON when the caller asks for it.
 *         The report page posts here from a script and stays put; only the reports site may read the answer (CORS), and a post from any other
 *         site records nothing.
 * OPTIONS answers a browser's preflight for the reports site.
 */
type Ctx = { params: Promise<{ token: string }> };

function wantsJson(request: NextRequest): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

function ownHosts(request: NextRequest): Array<string | null> {
  return [request.headers.get('x-forwarded-host'), request.headers.get('host'), request.nextUrl.host];
}

function respond(request: NextRequest, o: LinkOutcome, html: string): NextResponse {
  const cors = corsHeadersFor(request.headers.get('origin'));
  if (wantsJson(request)) {
    const { status, ...body } = o;
    return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...cors } });
  }
  return new NextResponse(html, { status: o.status, headers: { ...LINK_PAGE_HEADERS, ...cors } });
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
    if (!postOriginAllowed(request.headers.get('origin'), ownHosts(request))) return respond(request, FOREIGN_ORIGIN, outcomePage(FOREIGN_ORIGIN));
    const { token } = await params;
    const o = await redeemAnswerLink(token);
    return respond(request, o, outcomePage(o));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS(request: NextRequest) {
  const cors = corsHeadersFor(request.headers.get('origin'));
  const allowed = 'Access-Control-Allow-Origin' in cors;
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...cors,
      ...(allowed ? { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Accept, Content-Type', 'Access-Control-Max-Age': '600' } : {}),
      'Cache-Control': 'no-store',
    },
  });
}
