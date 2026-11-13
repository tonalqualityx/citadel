import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { refreshSession, setAuthCookies } from '@/lib/auth/refresh-session';
import { handleApiError } from '@/lib/api/errors';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const tokens = await refreshSession(cookieStore.get('refresh_token')?.value);

    const response = NextResponse.json({ success: true });
    setAuthCookies(response, tokens);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
