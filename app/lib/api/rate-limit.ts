import { NextRequest, NextResponse } from 'next/server';

interface RateLimitEntry {
  count: number;
  lastReset: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

// Clean up old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (now - entry.lastReset > 60000) {
      rateLimitMap.delete(key);
    }
  }
}, 60000);

/**
 * Simple in-memory rate limiter
 * @param request - The incoming request
 * @param limit - Max requests per window (default: 100)
 * @param windowMs - Time window in ms (default: 60000 = 1 minute)
 * @returns NextResponse with 429 status if rate limited, null otherwise
 */
export function rateLimit(
  request: NextRequest,
  limit: number = 100,
  windowMs: number = 60000
): NextResponse | null {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0] ||
             request.headers.get('x-real-ip') ||
             'unknown';
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now - entry.lastReset > windowMs) {
    rateLimitMap.set(ip, { count: 1, lastReset: now });
    return null;
  }

  if (entry.count >= limit) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
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
