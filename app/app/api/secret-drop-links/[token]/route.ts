import { NextRequest, NextResponse } from 'next/server';
import { envelopeSchema, postOriginAllowed, publicView, submitDrop } from '@/lib/secret-drops/drops';
import { dropPage, newNonce, pageHeaders } from '@/lib/secret-drops/page';

/**
 * A secret drop link (lib/secret-drops/drops.ts). No session: the signed token is the permission.
 *
 * GET   the page Mike pastes the key into; as JSON (Accept: application/json), the drop's status only. Never the ciphertext.
 * POST  the key, already encrypted in his browser to the machine's public key. Taken once. The body is never logged.
 */
type Ctx = { params: Promise<{ token: string }> };

const JSON_HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };

function wantsJson(request: NextRequest): boolean {
  return (request.headers.get('accept') ?? '').includes('application/json');
}

const MESSAGES: Record<string, string> = {
  received: 'Received.',
  altered: 'This link does not match a link Citadel made. Nothing was sent.',
  used: 'This link already took a key. Nothing more was sent.',
  expired: 'This link has expired. Nothing was sent.',
  bad: 'That did not arrive as an encrypted key. Nothing was kept.',
  foreign: 'A key can only be sent from its own page. Nothing was kept.',
};

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { token } = await params;
    const v = await publicView(token);
    if (wantsJson(request)) {
      const { public_key: _pk, ...rest } = v;
      void _pk;
      return NextResponse.json(rest, { status: v.ok ? 200 : 400, headers: JSON_HEADERS });
    }
    const nonce = newNonce();
    const { html, status } = dropPage(v, nonce);
    return new NextResponse(html, { status, headers: pageHeaders(nonce) });
  } catch {
    // never echo anything about the request
    return NextResponse.json({ ok: false, message: 'Something went wrong on our side. Nothing was kept.' }, { status: 500, headers: JSON_HEADERS });
  }
}

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const own = [request.headers.get('x-forwarded-host'), request.headers.get('host'), request.nextUrl.host];
    if (!postOriginAllowed(request.headers.get('origin'), own)) {
      return NextResponse.json({ ok: false, code: 'foreign_origin', message: MESSAGES.foreign }, { status: 403, headers: JSON_HEADERS });
    }
    const { token } = await params;
    let parsed;
    try {
      parsed = envelopeSchema.safeParse(await request.json());
    } catch {
      parsed = null;
    }
    if (!parsed || !parsed.success) return NextResponse.json({ ok: false, code: 'bad_envelope', message: MESSAGES.bad }, { status: 400, headers: JSON_HEADERS });
    const o = await submitDrop(token, parsed.data);
    return NextResponse.json({ ok: o.ok, code: o.code, status: o.status, message: MESSAGES[o.code] }, { status: o.httpStatus, headers: JSON_HEADERS });
  } catch {
    return NextResponse.json({ ok: false, message: 'Something went wrong on our side. Nothing was kept.' }, { status: 500, headers: JSON_HEADERS });
  }
}
