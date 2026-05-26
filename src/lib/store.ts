/**
 * Data access layer — Phase 2b: backed by Supabase Postgres.
 *
 * Exported function signatures are identical to Phase 2a so no route file changes.
 * The `resolved` fields (ean, product_url, product_name, ocoi_token) are stored
 * as separate columns in the queries table, not in JSONB.
 */
import { createServiceClient } from '@/lib/db';
import type { QueryDetail, QueryStatus, AnalysisResult } from '@/types/api';

export interface CreateQueryInput {
  user_id: string;
  input: string;
  input_type: QueryDetail['input_type'];
  context?: QueryDetail['resolved'];
}

// Module-level singleton — createServiceClient() is called once at module load
const db = createServiceClient();

// ─── Shape helpers ────────────────────────────────────────────────────────────

function rowToQueryDetail(
  row: Record<string, unknown>,
  analysis?: Record<string, unknown> | null,
  offers?: Record<string, unknown>[] | null,
): QueryDetail {
  const q: QueryDetail = {
    id: row.id as string,
    user_id: row.user_id as string,
    status: row.status as QueryStatus,
    status_message: row.status_message as string | undefined,
    created_at: row.created_at as string,
    completed_at: row.completed_at as string | undefined,
    input: row.input as string,
    input_type: row.input_type as QueryDetail['input_type'],
    resolved: {
      ean: row.ean as string | undefined,
      product_url: row.product_url as string | undefined,
      product_name: row.product_name as string | undefined,
      ocoi_token: row.ocoi_token as string | undefined,
    },
  };

  if (row.error_code) {
    q.error = {
      code: row.error_code as string,
      message: row.error_message as string,
      retryable: row.error_retryable as boolean,
    };
  }

  if (analysis) {
    // Map offer rows from the `offers` table into the typed Offer shape
    const mappedOffers: AnalysisResult['offers'] = (offers ?? []).map(o => ({
      id: o.id as string,
      offer_id: o.offer_id as string,
      seller: o.seller as string,
      price: o.price as number,
      total_with_delivery: o.total_with_delivery as number | undefined,
      recommend_pct: o.recommend_pct as number | undefined,
      reviews: o.reviews as number | undefined,
      sold_recent: (o.sold_recent ?? 0) as number,
      delivery: o.delivery_raw as string | undefined,
      badges: o.badges as AnalysisResult['offers'][number]['badges'],
      title: o.title as string,
      offer_url: o.offer_url as string | undefined,
    }));

    q.result = {
      market: analysis.market_summary as AnalysisResult['market'],
      archetype: {
        archetype: analysis.archetype as AnalysisResult['archetype']['archetype'],
        confidence: analysis.archetype_confidence as AnalysisResult['archetype']['confidence'],
        reasoning: analysis.archetype_reasoning as string,
        playbook_summary: analysis.archetype_playbook as string,
      },
      offers: mappedOffers,
      recommendations: (analysis.recommendations ?? []) as AnalysisResult['recommendations'],
      user_seller_verdict: analysis.user_seller_verdict as AnalysisResult['user_seller_verdict'],
    };
  }

  return q;
}

// ─── Queries ─────────────────────────────────────────────────────────────────

export async function insertQuery(input: CreateQueryInput): Promise<QueryDetail> {
  const { data, error } = await db
    .from('queries')
    .insert({
      user_id: input.user_id,
      input: input.input,
      input_type: input.input_type,
      ean: input.context?.ean,
      product_url: input.context?.product_url,
      product_name: input.context?.product_name,
      ocoi_token: input.context?.ocoi_token,
    })
    .select()
    .single();

  if (error || !data) throw new Error(`insertQuery failed: ${error?.message}`);

  // Increment monthly quota counter. Non-fatal: the function may not exist yet if
  // migration 0002_increment_quota_fn.sql hasn't been applied to the Supabase project.
  const { error: incrementError } = await db.rpc('increment_monthly_queries', { p_user_id: input.user_id });
  if (incrementError) {
    console.warn(`[store] quota increment skipped (run migration 0002): ${incrementError.message}`);
  }

  return rowToQueryDetail(data);
}

export async function getQuery(id: string): Promise<QueryDetail | undefined> {
  const { data } = await db.from('queries').select('*').eq('id', id).single();
  if (!data) return undefined;
  const [{ data: analysis }, { data: offers }] = await Promise.all([
    db.from('analyses').select('*').eq('query_id', id).maybeSingle(),
    db.from('offers').select('*').eq('query_id', id),
  ]);
  return rowToQueryDetail(data, analysis, offers);
}

export async function getQueryForUser(id: string, user_id: string): Promise<QueryDetail | undefined> {
  const { data } = await db
    .from('queries')
    .select('*')
    .eq('id', id)
    .eq('user_id', user_id)
    .single();
  if (!data) return undefined;
  const [{ data: analysis }, { data: offers }] = await Promise.all([
    db.from('analyses').select('*').eq('query_id', id).maybeSingle(),
    db.from('offers').select('*').eq('query_id', id),
  ]);
  return rowToQueryDetail(data, analysis, offers);
}

export async function listQueriesForUser(
  user_id: string,
  opts?: { status?: QueryStatus; limit?: number; offset?: number }
): Promise<{ queries: QueryDetail[]; total: number }> {
  const limit = opts?.limit ?? 20;
  const offset = opts?.offset ?? 0;

  let query = db
    .from('queries')
    .select('*', { count: 'exact' })
    .eq('user_id', user_id)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (opts?.status) query = query.eq('status', opts.status);

  const { data, count, error } = await query;
  if (error) throw new Error(`listQueriesForUser failed: ${error.message}`);

  return {
    queries: (data ?? []).map(row => rowToQueryDetail(row)),
    total: count ?? 0,
  };
}

export async function updateQueryStatus(
  id: string,
  status: QueryStatus,
  patch?: Partial<QueryDetail>
): Promise<QueryDetail | undefined> {
  const update: Record<string, unknown> = { status };
  if (patch?.status_message !== undefined) update.status_message = patch.status_message;
  if (patch?.resolved) {
    update.ean = patch.resolved.ean;
    update.product_url = patch.resolved.product_url;
    update.product_name = patch.resolved.product_name;
    update.ocoi_token = patch.resolved.ocoi_token;
  }
  if (status === 'completed' || status === 'failed') {
    update.completed_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from('queries')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`updateQueryStatus failed: ${error.message}`);
  if (!data) return undefined; // query not found — caller handles this
  return rowToQueryDetail(data);
}

export async function attachResult(id: string, result: AnalysisResult): Promise<QueryDetail | undefined> {
  // Upsert offers (one row per offer)
  if (result.offers.length > 0) {
    const offersToInsert = result.offers.map(o => ({
      query_id: id,
      offer_id: o.offer_id,
      seller: o.seller,
      title: o.title,
      offer_url: o.offer_url,
      price: o.price,
      total_with_delivery: o.total_with_delivery,
      recommend_pct: o.recommend_pct,
      reviews: o.reviews,
      sold_recent: o.sold_recent,
      badges: o.badges,
      delivery_raw: o.delivery,
    }));
    const { error: offersError } = await db.from('offers').upsert(offersToInsert, { onConflict: 'query_id,offer_id' });
    if (offersError) throw new Error(`attachResult: offers upsert failed: ${offersError.message}`);
  }

  // Upsert analysis — offers are stored in the `offers` table above.
  const { error: analysisError } = await db.from('analyses').upsert({
    query_id: id,
    archetype: result.archetype.archetype,
    archetype_confidence: result.archetype.confidence,
    archetype_reasoning: result.archetype.reasoning,
    archetype_playbook: result.archetype.playbook_summary,
    market_summary: result.market,
    recommendations: result.recommendations,
    user_seller_verdict: result.user_seller_verdict ?? null,
  }, { onConflict: 'query_id' });
  if (analysisError) throw new Error(`attachResult: analyses upsert failed: ${analysisError.message}`);

  // Mark query completed
  const { data, error } = await db
    .from('queries')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) return undefined;
  const [{ data: analysis }, { data: offers }] = await Promise.all([
    db.from('analyses').select('*').eq('query_id', id).maybeSingle(),
    db.from('offers').select('*').eq('query_id', id),
  ]);
  return rowToQueryDetail(data, analysis, offers);
}

/** No-op in Phase 2b — kept for test compatibility. Use Supabase dashboard to clean test data. */
export function _resetStore() {
  // no-op
}
