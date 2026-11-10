import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  lastReset: number;
  /** The window this entry was counted in. The cleanup keeps an entry for its own window, not a fixed minute. */
  windowMs: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/** Drop entries whose own window has passed. A window longer than a minute (10 an hour, say) survives the sweep. */
export function sweepRateLimits(now: number = Date.now()): void {
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.lastReset > entry.windowMs) {
      rateLimitMap.delete(key);
    }
  }
}

// Clean up old entries periodically
setInterval(() => sweepRateLimits(), 60000);

/**
 * Simple in-memory rate limiter
 * @param request - The incoming request
 * @param limit - Max requests per window (default: 100)
 * @param windowMs - Time window in ms (default: 60000 = 1 minute)
 * @param bucket - Counter name. Each bucket counts on its own, so reads and writes do not share a
 *   budget. Reported to the client as `limit: "ip:<bucket>"` on a 429.
 * @returns NextResponse with 429 status if rate limited, null otherwise
 */
export function rateLimit(
  request: NextRequest,
  limit: number = 100,
  windowMs: number = 60000,
  bucket: string = 'default'
): NextResponse | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
             request.headers.get('x-real-ip') ||
             'unknown';
  const key = bucket === 'default' ? ip : `${bucket}:${ip}`;
  return countHit(key, limit, windowMs, `ip:${bucket}`);
}

/**
 * The same in-memory limiter keyed on a value the server already trusts (a signed-in user id), never on a request
 * header. For per-user limits: changing X-Forwarded-For cannot reset it. Reported as `limit: "user:<bucket>"`.
 */
export function rateLimitByKey(
  key: string,
  limit: number,
  windowMs: number,
  bucket: string
): NextResponse | null {
  return countHit(`key:${bucket}:${key}`, limit, windowMs, `user:${bucket}`);
}

function countHit(key: string, limit: number, windowMs: number, label: string): NextResponse | null {
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now - entry.lastReset > windowMs) {
    rateLimitMap.set(key, { count: 1, lastReset: now, windowMs });
    return null;
  }

  if (entry.count >= limit) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.', limit: label },
      {
        status: 429,
        headers: {
          'Retry-After': String(Math.ceil((entry.lastReset + windowMs - now) / 1000)),
        },
      }
    );
  }

  entry.count++;
  return null;
}

/**
 * Stricter rate limit for auth endpoints
 * 10 requests per minute by default
 */
export function authRateLimit(request: NextRequest): NextResponse | null {
  return rateLimit(request, 10, 60000);
}

/**
 * Portal reads (the chat view, the work page and the other GETs). The chat polls every 3 to 8
 * seconds, so reads get their own counter at 600 a minute and never eat the 120 a minute that
 * the portal's writes (POST) have.
 */
export const PORTAL_READ_LIMIT_PER_MINUTE = 600;
export function portalReadRateLimit(request: NextRequest): NextResponse | null {
  return rateLimit(request, PORTAL_READ_LIMIT_PER_MINUTE, 60000, 'portal-read');
}
