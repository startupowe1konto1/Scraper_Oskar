/**
 * GET /api/v1/queries/:id — full detail of one query + its analysis (when complete).
 *
 * Phase 2a: returns mock data for the query. If the query has been "completed"
 *           (in our in-memory store), returns the attached AnalysisResult.
 *           For now, queries never auto-complete because the worker isn't wired up.
 *           Use the test helper at POST /api/v1/queries/:id/complete-test to
 *           simulate completion during development.
 */
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { getQueryForUser } from '@/lib/store';
import type { User, ApiError } from '@/types/api';

interface RouteContext {
  params: { id: string };
}

export async function GET(req: Request, { params }: RouteContext) {
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
  const query = await getQueryForUser(params.id, user.id);

  if (!query) {
    const body: ApiError = {
      error: {
        code: 'NOT_FOUND',
        message: 'Query not found or you do not have access to it.',
      },
    };
    return NextResponse.json(body, { status: 404 });
  }

  return NextResponse.json(query, { status: 200 });
}
