/**
 * Shoppalyzer API contract — source of truth for frontend / backend agreement.
 *
 * Versioning rule: any breaking change here bumps the URL prefix from /api/v1/* to /api/v2/*.
 * Non-breaking additions (new optional fields, new endpoints) stay on v1.
 */

// ─── Shared primitives ─────────────────────────────────────────────────────

export type UUID = string;
export type ISODateString = string;

export type Plan = 'free' | 'pro' | 'enterprise';

export type Archetype =
  | 'VOLUME_DRIVEN'
  | 'PAY_TO_PLAY'
  | 'BADGE_DRIVEN'
  | 'PRICE_THRESHOLD'
  | 'PRICE_TIERED'
  | 'MIXED'
  | 'UNKNOWN';

export type Tier =
  | 'DEEP_DISCOUNT'
  | 'MID_TRUST'
  | 'BRAND_RETAILER'
  | 'MSRP_HOLD'
  | 'WEAK_DISCOUNT'
  | 'UNTRUSTED_MIDDLE'
  | 'OUTLET_REFURB'
  | 'PAWN_SHOP'
  | 'AUCTION_STUB'
  | 'MIXED'
  | 'UNKNOWN';

export type PromoteDecision = 'PROMOTE' | 'TEST_PROMOTE' | 'HOLD' | 'AVOID' | 'DONT_PROMOTE' | 'STOP_PROMOTE' | 'OPTIONAL';

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export type QueryStatus =
  | 'queued'        // submitted, waiting for worker
  | 'discovering'   // resolving EAN / product page
  | 'scraping'      // hitting Allegro
  | 'parsing'       // parsing scraped data
  | 'analyzing'     // running recommendation engine
  | 'completed'     // ready to view
  | 'failed';       // unrecoverable error

// ─── Auth ──────────────────────────────────────────────────────────────────

export interface User {
  id: UUID;
  email: string;
  plan: Plan;
  created_at: ISODateString;
  monthly_queries_used: number;
  monthly_queries_limit: number;
}

// ─── Submit a query ────────────────────────────────────────────────────────

/** POST /api/v1/queries */
export interface CreateQueryRequest {
  /** Either an Allegro product offer URL OR an EAN */
  input: string;
  /** What input type the user provided */
  input_type: 'allegro_url' | 'ean' | 'product_url' | 'auto';
  /** Optional metadata for portfolio submissions */
  context?: {
    /** Seller's own ID/name for grouping */
    seller_ref?: string;
    /** Optional product name for display while waiting */
    display_name?: string;
  };
}

/** POST /api/v1/queries/batch (CSV upload) */
export interface CreateBatchQueryRequest {
  /** Array of single-query inputs */
  queries: CreateQueryRequest[];
  /** Optional batch label (e.g. "Q2 2026 portfolio review") */
  batch_label?: string;
}

export interface QueryRef {
  query_id: UUID;
  status: QueryStatus;
  estimated_completion: ISODateString;
}

export interface CreateQueryResponse {
  query: QueryRef;
}

export interface CreateBatchQueryResponse {
  batch_id: UUID;
  queries: QueryRef[];
}

// ─── Read a query ──────────────────────────────────────────────────────────

/** GET /api/v1/queries/:id */
export interface QueryDetail {
  id: UUID;
  user_id: UUID;
  status: QueryStatus;
  status_message?: string;
  created_at: ISODateString;
  completed_at?: ISODateString;

  /** What the user submitted */
  input: string;
  input_type: CreateQueryRequest['input_type'];

  /** What we resolved */
  resolved: {
    ean?: string;
    product_url?: string;
    product_name?: string;
    ocoi_token?: string;
  };

  /** Filled when status === 'completed' */
  result?: AnalysisResult;

  /** Filled when status === 'failed' */
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

// ─── Analysis result ───────────────────────────────────────────────────────

export interface AnalysisResult {
  /** Market-level summary */
  market: MarketSummary;

  /** Category archetype */
  archetype: ArchetypeAssessment;

  /** All sellers parsed for the product */
  offers: Offer[];

  /** Per-seller recommendation engine output */
  recommendations: SellerRecommendation[];

  /** Headline "what should you do" verdict for the user's seller (if specified) */
  user_seller_verdict?: SellerRecommendation;
}

export interface MarketSummary {
  total_offers: number;
  organic_count: number;
  sponsored_count: number;
  total_visible_sales_30d: number;
  price_min: number;
  price_median: number;
  price_max: number;
  msrp_reference: number;
  msrp_source: 'brand_retailer' | 'top_quartile_badged' | 'fallback';
}

export interface ArchetypeAssessment {
  archetype: Archetype;
  confidence: Confidence;
  reasoning: string;
  playbook_summary: string;
}

export interface Offer {
  id: UUID;
  offer_id: string;          // Allegro's offerId
  seller: string;
  price: number;
  total_with_delivery?: number;
  recommend_pct?: number;
  reviews?: number;
  sold_recent: number;
  delivery?: string;
  badges: {
    smart: boolean;
    super_seller: boolean;
    top_offer: boolean;
    contains_promo: boolean;
    sponsored: boolean;
    firma: boolean;
    official_store: boolean;
    super_price?: boolean;
  };
  title: string;
  offer_url?: string;
}

export interface SellerRecommendation {
  seller: string;
  tier: {
    code: Tier;
    label: string;
    why: string;
  };
  scorecard: {
    score: number; // 0-100
    breakdown: {
      badges: string;
      price: string;
      recommend: string;
      reviews: string;
      delivery: string;
    };
  };
  top_offer: {
    score: number;
    rank: number;
    probability: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH';
    predicted_winner: boolean;
  };
  distance_to_conversion: DistanceToConversion;
  promote_recommendation: {
    decision: PromoteDecision;
    confidence: Confidence;
    reasoning: string;
  };
  what_if_moves: WhatIfMove[];
}

export type DistanceToConversion =
  | { status: 'converting'; message: string }
  | { status: 'unknown'; message: string }
  | {
      status: 'non_converting';
      price_above_cheapest_converter: number | null;
      price_above_cheapest_converter_pct: number | null;
      nearest_converter: { seller: string; price: number; sold: number; gap: number } | null;
      nearest_cheaper_converter: { seller: string; price: number; sold: number; gap_to_close: number } | null;
    };

export interface WhatIfMove {
  move: string;
  change: string;
  predicted_tier: string;
  predicted_impact: string;
  feasibility: 'EASY' | 'EASY-MEDIUM' | 'MEDIUM' | 'HARD';
}

// ─── List queries (dashboard) ──────────────────────────────────────────────

/** GET /api/v1/queries?limit=20&offset=0&status=completed */
export interface ListQueriesResponse {
  queries: Array<Pick<QueryDetail,
    'id' | 'status' | 'created_at' | 'completed_at' | 'input' | 'resolved'
  > & {
    /** Compact result preview for dashboard cards */
    preview?: {
      archetype: Archetype;
      verdict: PromoteDecision;
      top_seller_price?: number;
      top_seller_sold?: number;
    };
  }>;
  total: number;
}

// ─── Generate PDF report ───────────────────────────────────────────────────

/** POST /api/v1/queries/:id/pdf */
export interface GeneratePdfRequest {
  /** Which style of report to generate */
  template: 'editorial' | 'compact' | 'seller_summary';
  /** Optional title override */
  title?: string;
}

export interface GeneratePdfResponse {
  pdf_url: string;
  expires_at: ISODateString;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export interface ApiError {
  error: {
    code: string;        // e.g. 'INVALID_INPUT', 'NOT_FOUND', 'RATE_LIMITED'
    message: string;
    details?: unknown;
  };
}
