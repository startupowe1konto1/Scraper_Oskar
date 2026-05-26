/**
 * Recommendation engine — converts raw offer data into AnalysisResult.
 *
 * Entry point: buildAnalysisResult(offers, productName?)
 */
import { randomUUID } from 'crypto';
import type {
  Offer,
  AnalysisResult,
  MarketSummary,
  ArchetypeAssessment,
  SellerRecommendation,
  Archetype,
  Tier,
  PromoteDecision,
  Confidence,
} from '@/types/api';

// ─── Market Summary ─────────────────────────────────────────────────────────

function computeMarketSummary(offers: Offer[]): MarketSummary {
  const organic = offers.filter(o => !o.badges.sponsored);
  const sponsored = offers.filter(o => o.badges.sponsored);
  const prices = offers.map(o => o.price).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const price_median =
    prices.length % 2 === 0
      ? (prices[mid - 1] + prices[mid]) / 2
      : prices[mid];
  const totalSales = offers.reduce((s, o) => s + (o.sold_recent ?? 0), 0);

  // MSRP reference: official store price > badged price > 75th percentile
  const official = offers.filter(o => o.badges.official_store);
  const badgeRich = offers.filter(o => o.badges.smart || o.badges.super_seller);
  let msrp_reference = 0;
  let msrp_source: MarketSummary['msrp_source'] = 'fallback';

  if (official.length > 0) {
    msrp_reference = Math.max(...official.map(o => o.price));
    msrp_source = 'brand_retailer';
  } else if (badgeRich.length > 0) {
    msrp_reference = Math.max(...badgeRich.map(o => o.price));
    msrp_source = 'top_quartile_badged';
  } else {
    const p75idx = Math.min(Math.floor(prices.length * 0.75), prices.length - 1);
    msrp_reference = prices[p75idx] ?? 0;
    msrp_source = 'fallback';
  }

  return {
    total_offers: offers.length,
    organic_count: organic.length,
    sponsored_count: sponsored.length,
    total_visible_sales_30d: totalSales,
    price_min: prices[0] ?? 0,
    price_median,
    price_max: prices[prices.length - 1] ?? 0,
    msrp_reference,
    msrp_source,
  };
}

// ─── Archetype Classification ────────────────────────────────────────────────

function detectPriceThresholdGap(offers: Offer[]): number {
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  let maxGap = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i - 1].price <= 0) continue; // skip zero-price items
    const gap = (sorted[i].price - sorted[i - 1].price) / sorted[i - 1].price;
    const lowSide = sorted.slice(0, i);
    const highSide = sorted.slice(i);
    const lowSideSales = lowSide.reduce((s, o) => s + (o.sold_recent ?? 0), 0);
    const highSideSales = highSide.reduce((s, o) => s + (o.sold_recent ?? 0), 0);
    // Require: low side has sales (conversion happens below), high side has none
    if (lowSideSales > 0 && highSideSales === 0 && gap > maxGap) maxGap = gap;
  }
  return maxGap;
}

function detectPriceTiers(offers: Offer[]): number {
  if (offers.length < 4) return 1;
  const prices = offers.map(o => o.price).sort((a, b) => a - b);
  const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
  const variance = prices.reduce((s, p) => s + Math.pow(p - mean, 2), 0) / prices.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return 1;
  // A gap larger than 1 standard deviation between consecutive prices = a tier boundary
  const gaps = prices.slice(1).map((p, i) => p - prices[i]);
  return 1 + gaps.filter(g => g > stddev).length;
}

function detectThresholdPrice(offers: Offer[]): number {
  const sorted = [...offers].sort((a, b) => a.price - b.price);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted.slice(i).every(o => (o.sold_recent ?? 0) === 0)) return sorted[i - 1].price;
  }
  return 0;
}

function classifyArchetype(offers: Offer[], market: MarketSummary): ArchetypeAssessment {
  if (offers.length < 3) {
    return {
      archetype: 'UNKNOWN',
      confidence: 'LOW',
      reasoning: 'Too few offers to classify market archetype.',
      playbook_summary: 'Gather more data before drawing conclusions.',
    };
  }

  const totalSales = market.total_visible_sales_30d;
  const sorted = [...offers].sort((a, b) => (b.sold_recent ?? 0) - (a.sold_recent ?? 0));
  const top3Sales = sorted.slice(0, 3).reduce((s, o) => s + (o.sold_recent ?? 0), 0);
  const sponsoredPct = market.total_offers > 0 ? market.sponsored_count / market.total_offers : 0;
  const top5 = sorted.slice(0, 5);
  const badgedTop5 = top5.filter(o => o.badges.smart && o.badges.super_seller).length;
  const priceGap = detectPriceThresholdGap(offers);
  const tierCount = detectPriceTiers(offers);

  const scores: Partial<Record<Archetype, number>> = {};
  if (totalSales > 0 && top3Sales / totalSales > 0.6) scores.VOLUME_DRIVEN = top3Sales / totalSales;
  if (sponsoredPct > 0.4) scores.PAY_TO_PLAY = sponsoredPct;
  if (top5.length > 0 && badgedTop5 / top5.length > 0.6) scores.BADGE_DRIVEN = badgedTop5 / top5.length;
  if (priceGap > 0.15) scores.PRICE_THRESHOLD = priceGap;
  if (tierCount >= 2) scores.PRICE_TIERED = Math.min(tierCount / 3, 1);

  const winner = Object.entries(scores).sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))[0];
  const winnerScore = winner?.[1] ?? 0;
  const archetype: Archetype = winnerScore > 0.3 ? (winner![0] as Archetype) : 'MIXED';
  const confidence: Confidence = winnerScore > 0.7 ? 'HIGH' : winnerScore > 0.4 ? 'MEDIUM' : 'LOW';

  const playbooks: Record<Archetype, string> = {
    VOLUME_DRIVEN:
      'A few sellers dominate sales. Focus on beating the leader on price or logistics, or target the long tail.',
    PAY_TO_PLAY:
      'Sponsored placement is critical. Organic visibility is low — invest in Allegro Ads or accept lower volume.',
    BADGE_DRIVEN:
      'Smart + Super Seller badges are table stakes. Get them before scaling ad spend.',
    PRICE_THRESHOLD:
      'There is a clear price point below which conversion happens. Price below the threshold to convert.',
    PRICE_TIERED:
      'Multiple price segments exist. Choose your tier deliberately and differentiate within it.',
    MIXED: 'Multiple dynamics are at play. Analyze each seller segment separately.',
    UNKNOWN: 'Insufficient data for recommendations.',
  };

  const reasonings: Record<Archetype, string> = {
    VOLUME_DRIVEN: `Top 3 sellers account for ${Math.round((top3Sales / Math.max(totalSales, 1)) * 100)}% of visible sales.`,
    PAY_TO_PLAY: `${Math.round(sponsoredPct * 100)}% of offers are sponsored listings.`,
    BADGE_DRIVEN: `${badgedTop5} of top 5 sellers by sales have both Smart and Super Seller badges.`,
    PRICE_THRESHOLD: `Price-to-sales data shows a conversion cliff at ~${detectThresholdPrice(offers)} PLN.`,
    PRICE_TIERED: `Prices cluster into ${tierCount} distinct bands.`,
    MIXED: 'No single archetype dominates; multiple market forces are active.',
    UNKNOWN: 'Not enough offers to classify.',
  };

  return {
    archetype,
    confidence,
    reasoning: reasonings[archetype],
    playbook_summary: playbooks[archetype],
  };
}

// ─── Seller Scoring ──────────────────────────────────────────────────────────

function scoreOffer(offer: Offer, market: MarketSummary): number {
  // Badge score (30 pts)
  const badgePoints =
    (offer.badges.smart ? 2 : 0) +
    (offer.badges.super_seller ? 2 : 0) +
    (offer.badges.top_offer ? 1 : 0) +
    (offer.badges.official_store ? 3 : 0) -
    (offer.badges.sponsored ? 0.5 : 0);
  const badgeScore = Math.min(badgePoints / 5, 1) * 30;

  // Price score (25 pts) — lower vs MSRP = better
  const priceRatio = market.msrp_reference > 0 ? offer.price / market.msrp_reference : 1;
  const priceScore = Math.max(0, (1 - Math.max(priceRatio - 0.6, 0) / 0.4)) * 25;

  // Recommend % score (20 pts)
  const recScore = ((offer.recommend_pct ?? 80) / 100) * 20;

  // Reviews score (15 pts) — log scale
  const revScore = offer.reviews ? Math.min(Math.log10(offer.reviews + 1) / 4, 1) * 15 : 0;

  // Delivery score (10 pts)
  const delivery = offer.delivery ?? '';
  const delivScore = /dzisiaj|jutro|w\s+sobotę/i.test(delivery) ? 10 : /\d+\s+dni/.test(delivery) ? 5 : 7;

  return Math.round(badgeScore + priceScore + recScore + revScore + delivScore);
}

function assignTier(
  offer: Offer,
  score: number,
  market: MarketSummary,
): { code: Tier; label: string; why: string } {
  const priceRatio = market.msrp_reference > 0 ? offer.price / market.msrp_reference : 1;

  if (offer.badges.official_store)
    return { code: 'BRAND_RETAILER', label: 'Brand Retailer', why: 'Official store, sets market price anchor.' };
  if (offer.badges.smart && offer.badges.super_seller && (offer.recommend_pct ?? 0) >= 95)
    return { code: 'MID_TRUST', label: 'Mid Trust', why: 'Trusted seller with badges, competitive price.' };
  if (priceRatio < 0.75 && !offer.badges.smart && (offer.recommend_pct ?? 0) < 90)
    return { code: 'DEEP_DISCOUNT', label: 'Deep Discount', why: 'Lowest price but low trust signals.' };
  if (priceRatio >= 0.9 && offer.badges.smart)
    return { code: 'MSRP_HOLD', label: 'MSRP Hold', why: 'Holds near MSRP with badge credibility.' };
  if (priceRatio < 0.75 && offer.badges.smart)
    return { code: 'WEAK_DISCOUNT', label: 'Weak Discount', why: 'Discounted with some badge support.' };
  if (score < 30)
    return { code: 'UNTRUSTED_MIDDLE', label: 'Untrusted Middle', why: 'Mid-price with weak trust signals.' };
  return { code: 'MID_TRUST', label: 'Mid Trust', why: 'Average seller in competitive space.' };
}

function makePromoteDecision(
  score: number,
  sold: number,
): { decision: PromoteDecision; confidence: Confidence; reasoning: string } {
  if (score >= 70 && sold >= 5)
    return { decision: 'PROMOTE', confidence: 'HIGH', reasoning: 'Strong score and proven sales. Amplify with ads.' };
  if (score >= 50 && sold >= 1)
    return {
      decision: 'TEST_PROMOTE',
      confidence: 'MEDIUM',
      reasoning: 'Decent score. Test promotion with small budget first.',
    };
  if (score < 30)
    return {
      decision: 'DONT_PROMOTE',
      confidence: 'HIGH',
      reasoning: 'Low score. Fix fundamentals (price, badges, reviews) before spending on ads.',
    };
  if (sold === 0)
    return {
      decision: 'OPTIONAL',
      confidence: 'LOW',
      reasoning: 'No recent sales data. Promotion impact uncertain.',
    };
  return { decision: 'TEST_PROMOTE', confidence: 'LOW', reasoning: 'Mixed signals. Small test recommended.' };
}

function priceRatioPct(price: number, msrp: number): number {
  return msrp > 0 ? (price / msrp) * 100 : 100;
}

function buildRecommendation(
  offer: Offer,
  rank: number,
  market: MarketSummary,
  converting: Offer[],
): SellerRecommendation {
  const score = scoreOffer(offer, market);
  const tier = assignTier(offer, score, market);
  const promote = makePromoteDecision(score, offer.sold_recent ?? 0);
  const isConverting = (offer.sold_recent ?? 0) > 0;
  const cheapestConverter = [...converting].sort((a, b) => a.price - b.price)[0];

  const distance_to_conversion: SellerRecommendation['distance_to_conversion'] = isConverting
    ? { status: 'converting', message: 'This seller is actively converting sales.' }
    : converting.length === 0
    ? { status: 'unknown', message: 'No sellers with known sales data.' }
    : {
        status: 'non_converting',
        price_above_cheapest_converter: cheapestConverter ? offer.price - cheapestConverter.price : null,
        price_above_cheapest_converter_pct: cheapestConverter
          ? Math.round(((offer.price - cheapestConverter.price) / cheapestConverter.price) * 100)
          : null,
        nearest_converter: cheapestConverter
          ? {
              seller: cheapestConverter.seller,
              price: cheapestConverter.price,
              sold: cheapestConverter.sold_recent ?? 0,
              gap: offer.price - cheapestConverter.price,
            }
          : null,
        nearest_cheaper_converter:
          cheapestConverter && cheapestConverter.price < offer.price
            ? {
                seller: cheapestConverter.seller,
                price: cheapestConverter.price,
                sold: cheapestConverter.sold_recent ?? 0,
                gap_to_close: offer.price - cheapestConverter.price,
              }
            : null,
      };

  const what_if_moves = [];
  if (!offer.badges.smart)
    what_if_moves.push({
      move: 'Activate Smart delivery',
      change: '+Smart badge',
      predicted_tier: 'MID_TRUST',
      predicted_impact: 'Higher visibility in Smart filter, +10-20% CTR',
      feasibility: 'EASY' as const,
    });
  if (offer.price > market.price_median)
    what_if_moves.push({
      move: `Reduce price to ${Math.round(market.price_median)} PLN`,
      change: `-${Math.round(offer.price - market.price_median)} PLN`,
      predicted_tier: tier.code,
      predicted_impact: 'Enter median price band, increase conversion probability',
      feasibility: 'EASY-MEDIUM' as const,
    });
  if (!offer.badges.super_seller)
    what_if_moves.push({
      move: 'Earn Super Seller badge',
      change: '+Super Seller',
      predicted_tier: 'MID_TRUST',
      predicted_impact: 'Strong trust signal, opens access to top positions',
      feasibility: 'MEDIUM' as const,
    });

  const topOfferProb =
    rank === 0
      ? ('HIGH' as const)
      : rank <= 2
      ? ('MEDIUM' as const)
      : rank <= 5
      ? ('LOW' as const)
      : ('VERY_LOW' as const);

  return {
    seller: offer.seller,
    tier,
    scorecard: {
      score,
      breakdown: {
        badges:
          [
            offer.badges.smart && 'Smart',
            offer.badges.super_seller && 'SS',
            offer.badges.official_store && 'Official',
          ]
            .filter(Boolean)
            .join(' ') || 'None',
        price: `${offer.price} PLN (${Math.round(priceRatioPct(offer.price, market.msrp_reference))}% of MSRP)`,
        recommend: `${offer.recommend_pct ?? 'n/a'}%`,
        reviews: String(offer.reviews ?? 0),
        delivery: offer.delivery ?? 'standard',
      },
    },
    top_offer: { score, rank: rank + 1, probability: topOfferProb, predicted_winner: rank === 0 },
    distance_to_conversion,
    promote_recommendation: promote,
    what_if_moves: what_if_moves.slice(0, 3),
  };
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export function buildAnalysisResult(offers: Offer[], _productName?: string): AnalysisResult {
  if (offers.length === 0) {
    return {
      market: {
        total_offers: 0, organic_count: 0, sponsored_count: 0,
        total_visible_sales_30d: 0, price_min: 0, price_median: 0, price_max: 0,
        msrp_reference: 0, msrp_source: 'fallback',
      },
      archetype: { archetype: 'UNKNOWN', confidence: 'LOW', reasoning: 'No offers provided.', playbook_summary: 'Gather data first.' },
      offers: [],
      recommendations: [],
    };
  }
  const withIds = offers.map(o => ({ ...o, id: o.id || randomUUID() }));
  const market = computeMarketSummary(withIds);
  const archetype = classifyArchetype(withIds, market);
  const sorted = [...withIds].sort((a, b) => (b.sold_recent ?? 0) - (a.sold_recent ?? 0));
  const converting = withIds.filter(o => (o.sold_recent ?? 0) > 0);
  const recommendations = sorted.map((offer, rank) => buildRecommendation(offer, rank, market, converting));

  return { market, archetype, offers: withIds, recommendations };
}
