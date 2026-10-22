import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    /** Which limiter fired, on a 429 (for example requests_per_hour). Sent to the client as `limit`. */
    public limit?: string
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 401
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);

  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode }
    );
  }

  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...(error.limit ? { limit: error.limit } : {}) },
      { status: error.statusCode }
    );
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Validation failed', details: error.issues },
      { status: 400 }
    );
  }

  // Unknown error
  return NextResponse.json(
    { error: 'Internal server error' },
    { status: 500 }
  );
}

export function notFound(message: string = 'Not found'): NextResponse {
  return NextResponse.json(
    { error: message },
    { status: 404 }
  );
}
