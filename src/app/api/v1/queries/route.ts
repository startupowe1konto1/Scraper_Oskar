/**
 * POST /api/v1/queries — submit a single product for analysis
 * GET  /api/v1/queries — list the current user's queries
 *
 * Phase 2a: validates input, classifies the kind of URL/EAN, stores in mock memory,
 *           returns a queued query. NO scraping happens yet — the worker will be
 *           added in Phase 2b alongside Supabase persistence.
 */
import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { parseRequestBody, createQuerySchema } from '@/lib/validators';
import { parseAllegroInput, inputTypeFromKind } from '@/lib/allegro';
import { insertQuery, listQueriesForUser } from '@/lib/store';
import type {
  User,
  CreateQueryResponse,
  ListQueriesResponse,
  QueryStatus,
  ApiError,
} from '@/types/api';

// ─── POST /api/v1/queries ───────────────────────────────────────────────────
export async function POST(req: Request) {
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

  // Enforce monthly quota
  if (user.monthly_queries_used >= user.monthly_queries_limit) {
    const body: ApiError = {
      error: {
        code: 'QUOTA_EXCEEDED',
        message: `You have used ${user.monthly_queries_used} of ${user.monthly_queries_limit} queries this month. Upgrade your plan to submit more.`,
      },
    };
    return NextResponse.json(body, { status: 402 });
  }

  // Validate request body
  const parsed = await parseRequestBody(req, createQuerySchema);
  if (!parsed.ok) {
    return NextResponse.json(parsed.body, { status: parsed.status });
  }
  const { input, input_type, context } = parsed.data;

  // Detect what kind of input the user actually pasted (overriding `auto`)
  const resolved = parseAllegroInput(input);
  if (resolved.kind === 'unknown') {
    const body: ApiError = {
      error: {
        code: 'INVALID_INPUT',
        message:
          'Could not detect input type. Provide an Allegro offer URL ' +
          '(https://allegro.pl/oferta/...), a product page URL, or an EAN code.',
      },
    };
    return NextResponse.json(body, { status: 400 });
  }
  const effective_input_type =
    input_type === 'auto' ? inputTypeFromKind(resolved.kind) : input_type;

  // Create the query record. Status starts queued — the worker will pick it up.
  const query = await insertQuery({
    user_id: user.id,
    input,
    input_type: effective_input_type,
    context: {
      ean: resolved.ean,
      product_url: resolved.normalized_url,
      product_name: context?.display_name,
    },
  });

  // Estimate completion based on what kind of input we got
  const baseSeconds =
    resolved.kind === 'allegro_aggregator' ? 60 :       // we already have the ocoi
    resolved.kind === 'allegro_product' ? 120 :          // need 1 extra discovery scrape
    resolved.kind === 'ean' ? 180 :                      // need full discovery + aggregator
    150;                                                 // offer URL: discover the product, then aggregator
  const estimated_completion = new Date(Date.now() + baseSeconds * 1000).toISOString();

  const responseBody: CreateQueryResponse = {
    query: {
      query_id: query.id,
      status: query.status as QueryStatus,
      estimated_completion,
    },
  };

  return NextResponse.json(responseBody, { status: 201 });
}

// ─── GET /api/v1/queries ────────────────────────────────────────────────────
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
  const url = new URL(req.url);

  const limit = parseInt(url.searchParams.get('limit') ?? '20', 10);
  const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
  const status = (url.searchParams.get('status') ?? undefined) as QueryStatus | undefined;

  const { queries, total } = await listQueriesForUser(user.id, { limit, offset, status });

  const body: ListQueriesResponse = {
    queries: queries.map(q => ({
      id: q.id,
      status: q.status,
      created_at: q.created_at,
      completed_at: q.completed_at,
      input: q.input,
      resolved: q.resolved,
      // No preview in Phase 2a — added in 2b once analysis is wired up
    })),
    total,
  };

  return NextResponse.json(body, { status: 200 });
}
