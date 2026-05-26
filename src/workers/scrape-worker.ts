/**
 * Shoppalyzer Scrape Worker
 *
 * Long-running process that polls the `queries` table for queued jobs,
 * runs the Firecrawl pipeline, and writes results back to Supabase.
 *
 * Run with: npm run worker
 *
 * Requires env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *   (Firecrawl keys live in shoppalyzer-tools config)
 */

import { createServiceClient } from '@/lib/db';
import { scrapeAllegroPage, parseAllegroOffers, extractAggregatorUrl } from '@/lib/allegro-scraper';
import { buildAnalysisResult } from '@/lib/analyzer';
import type { QueryStatus } from '@/types/api';

const POLL_INTERVAL_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface QueryRow {
  id: string;
  user_id: string;
  status: QueryStatus;
  input: string;
  input_type: 'allegro_url' | 'product_url' | 'ean';
  ean?: string | null;
  product_url?: string | null;
  product_name?: string | null;
  ocoi_token?: string | null;
  created_at: string;
}

// ─── Supabase ────────────────────────────────────────────────────────────────

const db = createServiceClient();

// ─── Logging ─────────────────────────────────────────────────────────────────

function log(queryId: string | null, step: string, msg: string) {
  const prefix = queryId ? `[${queryId.slice(0, 8)}]` : '[worker]';
  console.log(`${new Date().toISOString()} ${prefix} [${step}] ${msg}`);
}

// ─── DB helpers ──────────────────────────────────────────────────────────────

async function setStatus(id: string, status: QueryStatus, message?: string) {
  const update: Record<string, unknown> = { status };
  if (message !== undefined) update.status_message = message;
  if (status === 'completed' || status === 'failed') {
    update.completed_at = new Date().toISOString();
  }
  const { error } = await db.from('queries').update(update).eq('id', id);
  if (error) log(id, status, `WARNING: status update failed: ${error.message}`);
}

async function markFailed(
  id: string,
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
  statusMessage?: string,
) {
  await db.from('queries').update({
    status: 'failed',
    completed_at: new Date().toISOString(),
    status_message: statusMessage ?? errorMessage,
    error_code: errorCode,
    error_message: errorMessage,
    error_retryable: retryable,
  }).eq('id', id);
}

async function logScrapeJob(
  queryId: string,
  step: string,
  url: string,
  credits: number,
  status: 'succeeded' | 'failed',
  errorMsg?: string,
) {
  await db.from('scrape_jobs').insert({
    query_id: queryId,
    step,
    url,
    status,
    credits_used: credits,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    error_message: errorMsg ?? null,
  });
}

// ─── URL resolution ──────────────────────────────────────────────────────────

async function resolveAggregatorUrl(query: QueryRow): Promise<string | null> {
  const { input, input_type, product_url, ean } = query;

  // If a resolved aggregator URL was already stored (e.g. from a previous attempt), use it.
  if (product_url && product_url.includes('/oferty-produktu/')) return product_url;

  // Single Allegro offer URL (e.g. /oferta/slug-id): scrape it to discover the
  // /oferty-produktu/ comparison page which lists all sellers.
  if (input_type === 'allegro_url') {
    const offerUrl = product_url ?? input;
    log(query.id, 'discovering', `Fetching offer page to find aggregator: ${offerUrl}`);
    try {
      const html = await scrapeAllegroPage(offerUrl);
      const aggregator = extractAggregatorUrl(html);
      if (aggregator) {
        log(query.id, 'discovering', `Found aggregator: ${aggregator}`);
        return aggregator;
      }
      // If no aggregator link found, the URL itself might already be the comparison page
      log(query.id, 'discovering', 'No /oferty-produktu/ link found on offer page');
    } catch (err: unknown) {
      log(query.id, 'discovering', `Offer page scrape failed: ${(err as Error).message}`);
    }
    return null;
  }

  // Product page URL (/produkt/slug-uuid): also look for the aggregator link.
  if (input_type === 'product_url') {
    const pageUrl = product_url ?? input;
    log(query.id, 'discovering', `Fetching product page to find aggregator: ${pageUrl}`);
    try {
      const html = await scrapeAllegroPage(pageUrl);
      const aggregator = extractAggregatorUrl(html);
      if (aggregator) return aggregator;
    } catch (err: unknown) {
      log(query.id, 'discovering', `Product page scrape failed: ${(err as Error).message}`);
    }
    return null;
  }

  // EAN: search Allegro listing, find offer URL, then discover its aggregator.
  if (input_type === 'ean' && ean) {
    const searchUrl = `https://allegro.pl/listing?string=${encodeURIComponent(ean)}&order=d`;
    log(query.id, 'discovering', `Searching Allegro for EAN ${ean}`);
    try {
      const html = await scrapeAllegroPage(searchUrl);
      // Prefer a direct /oferty-produktu/ link if search results page contains one
      const direct = extractAggregatorUrl(html);
      if (direct) return direct;
      // Fall back: find an offer URL in search results and recurse once
      const offerMatch = html.match(/href="(https:\/\/allegro\.pl\/oferta\/[^"?]+)"/);
      if (!offerMatch) return null;
      const offerHtml = await scrapeAllegroPage(offerMatch[1]);
      return extractAggregatorUrl(offerHtml);
    } catch (err: unknown) {
      log(query.id, 'discovering', `EAN search failed: ${(err as Error).message}`);
      return null;
    }
  }

  return null;
}

// ─── Main pipeline ───────────────────────────────────────────────────────────

async function processQuery(query: QueryRow) {
  const id = query.id;
  log(id, 'start', `Processing: ${query.input}`);
  try {
    // discovering
    await setStatus(id, 'discovering', 'Resolving product URL...');
    const aggregatorUrl = await resolveAggregatorUrl(query);

    if (!aggregatorUrl) {
      await markFailed(id, 'RESOLUTION_FAILED', 'Could not find Allegro product page for the given input.', false);
      log(id, 'discovering', 'FAILED: could not resolve aggregator URL');
      return;
    }

    log(id, 'discovering', `Resolved: ${aggregatorUrl}`);
    await db.from('queries').update({ product_url: aggregatorUrl }).eq('id', id);

    // scraping
    await setStatus(id, 'scraping', 'Fetching Allegro page...');
    let html: string;
    try {
      html = await scrapeAllegroPage(aggregatorUrl);
      await logScrapeJob(id, 'offers_aggregator', aggregatorUrl, 10, 'succeeded');
      log(id, 'scraping', `Fetched ${html.length} chars`);
    } catch (err: unknown) {
      const msg = (err as Error).message;
      await logScrapeJob(id, 'offers_aggregator', aggregatorUrl, 0, 'failed', msg);
      await markFailed(id, 'SCRAPE_FAILED', msg, true, `Scrape failed: ${msg}`);
      log(id, 'scraping', `FAILED: ${msg}`);
      return;
    }

    // parsing
    await setStatus(id, 'parsing', 'Parsing seller offers...');
    const offers = parseAllegroOffers(html);
    log(id, 'parsing', `Parsed ${offers.length} offers`);

    if (offers.length === 0) {
      await markFailed(id, 'PARSE_EMPTY', 'No seller offers could be parsed from the Allegro page.', true,
        'No offers found. Allegro markup may have changed.');
      return;
    }

    // analyzing
    await setStatus(id, 'analyzing', 'Running recommendation engine...');
    const result = buildAnalysisResult(offers, query.product_name ?? undefined);
    log(id, 'analyzing', `Archetype: ${result.archetype.archetype}, ${result.recommendations.length} recs`);

    // saving offers
    if (result.offers.length > 0) {
      const { error: offersError } = await db.from('offers').upsert(
        result.offers.map(o => ({
          query_id: id,
          offer_id: o.offer_id,
          seller: o.seller,
          title: o.title,
          offer_url: o.offer_url,
          price: o.price,
          total_with_delivery: o.total_with_delivery ?? null,
          recommend_pct: o.recommend_pct ?? null,
          reviews: o.reviews ?? null,
          sold_recent: o.sold_recent ?? null,
          badges: o.badges,
          delivery_raw: o.delivery ?? null,
        })),
        { onConflict: 'query_id,offer_id' },
      );
      if (offersError) {
        log(id, 'analyzing', `FAILED to save offers: ${offersError.message}`);
        await markFailed(id, 'SAVE_FAILED', offersError.message, true, 'Failed to save offers to database.');
        return;
      }
    }

    // saving analysis
    // Note: offers are persisted in the `offers` table above; the analyses table
    // stores archetype + market summary + recommendations only (no offers column).
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

    if (analysisError) {
      log(id, 'analyzing', `FAILED to save analysis: ${analysisError.message}`);
      await markFailed(id, 'SAVE_FAILED', analysisError.message, true, 'Failed to save analysis to database.');
      return;
    }

    // mark completed
    await db.from('queries').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      status_message: `Analysis complete: ${result.archetype.archetype} market, ${result.offers.length} sellers analyzed.`,
    }).eq('id', id);

    log(id, 'completed', `✓ Done. ${result.offers.length} offers, archetype: ${result.archetype.archetype}`);
  } catch (err: unknown) {
    const msg = (err as Error).message ?? 'Unknown error';
    log(id, 'error', `Unexpected error: ${msg}`);
    await markFailed(id, 'UNEXPECTED_ERROR', msg, true, `Unexpected error: ${msg}`);
  }
}

// ─── Poll loop ────────────────────────────────────────────────────────────────

async function claimNextQuery(): Promise<QueryRow | null> {
  // Try atomic RPC first (prevents double-processing in multi-worker setup)
  const { data: rpcData, error: rpcError } = await db.rpc('claim_queued_query');
  if (!rpcError) {
    // RPC exists and worked — trust its result (null means no queued items)
    return (rpcData as QueryRow | null) ?? null;
  }

  // RPC errored (doesn't exist yet) — fall back to non-atomic approach
  // Fallback: non-atomic read + conditional update
  const { data: rows } = await db
    .from('queries')
    .select('*')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1);

  if (!rows || rows.length === 0) return null;
  const q = rows[0] as QueryRow;

  // Conditional update — only succeeds if still queued (reduces races)
  const { error: updateError } = await db
    .from('queries')
    .update({ status: 'discovering' })
    .eq('id', q.id)
    .eq('status', 'queued');

  if (updateError) return null; // another worker grabbed it
  return q;
}

let _isPolling = false;

async function poll() {
  if (_isPolling) return; // prevent overlap
  _isPolling = true;
  try {
    const query = await claimNextQuery();
    if (query) await processQuery(query);
  } catch (err: unknown) {
    console.error(`[worker] Unhandled error in poll():`, (err as Error).message);
  } finally {
    _isPolling = false;
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

let _interval: ReturnType<typeof setInterval> | null = null;

function setupGracefulShutdown() {
  const shutdown = (signal: string) => {
    log(null, 'shutdown', `Received ${signal}, stopping worker...`);
    if (_interval) clearInterval(_interval);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  log(null, 'startup', '=== Shoppalyzer Scrape Worker starting ===');
  log(null, 'startup', `Supabase: ${process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  log(null, 'startup', `Poll interval: ${POLL_INTERVAL_MS}ms`);

  setupGracefulShutdown();

  const { error } = await db.from('queries').select('count').limit(1);
  if (error) {
    console.error('[worker] Cannot connect to Supabase:', error.message);
    process.exit(1);
  }
  log(null, 'startup', '✓ Supabase connection OK');

  await poll();
  _interval = setInterval(poll, POLL_INTERVAL_MS);
}

main().catch(err => {
  console.error('[worker] Fatal startup error:', err);
  process.exit(1);
});
