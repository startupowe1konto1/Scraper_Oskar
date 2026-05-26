/**
 * GET /api/v1/me — current user profile + plan + monthly usage.
 *
 * Phase 2b: reads the Supabase JWT from Authorization header and looks up the profile row.
 * Returns 401 if the token is missing or invalid.
 */
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import type { User, ApiError } from '@/types/api';

export async function GET(req: Request) {
  let user: User;
  try {
    user = await currentUser(req);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('INTERNAL:')) {
      const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred. Please try again later.' } };
      return NextResponse.json(body, { status: 500 });
    }
    const body: ApiError = { error: { code: 'UNAUTHENTICATED', message: 'Valid Bearer token required.' } };
    return NextResponse.json(body, { status: 401 });
  }
  return NextResponse.json(user, { status: 200 });
}
