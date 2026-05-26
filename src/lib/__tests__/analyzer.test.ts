import { describe, test, expect } from 'vitest';
import { buildAnalysisResult } from '../analyzer';
import type { Offer } from '@/types/api';

const BASE_BADGES = {
  smart: false,
  super_seller: false,
  top_offer: false,
  contains_promo: false,
  sponsored: false,
  firma: false,
  official_store: false,
};

let _offerCounter = 0;
function makeOffer(overrides: Partial<Offer>): Offer {
  const i = ++_offerCounter;
  return {
    id: `offer-${i}`,
    offer_id: `offer-id-${i}`,
    seller: overrides.seller ?? `seller-${i}`,
    price: 100,
    sold_recent: 0,
    title: 'Test Product',
    badges: { ...BASE_BADGES },
    ...overrides,
  };
}

describe('buildAnalysisResult', () => {
  test('returns UNKNOWN archetype for fewer than 3 offers', () => {
    const result = buildAnalysisResult([makeOffer({}), makeOffer({})]);
    expect(result.archetype.archetype).toBe('UNKNOWN');
  });

  test('computes market summary correctly', () => {
    const offers = [
      makeOffer({ price: 100, sold_recent: 10 }),
      makeOffer({ price: 200, sold_recent: 5 }),
      makeOffer({ price: 150, sold_recent: 0 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.market.price_min).toBe(100);
    expect(result.market.price_max).toBe(200);
    expect(result.market.total_visible_sales_30d).toBe(15);
    expect(result.market.total_offers).toBe(3);
  });

  test('detects VOLUME_DRIVEN when top sellers dominate sales', () => {
    const offers = [
      makeOffer({ price: 100, sold_recent: 80 }),
      makeOffer({ price: 110, sold_recent: 15 }),
      makeOffer({ price: 120, sold_recent: 2 }),
      makeOffer({ price: 130, sold_recent: 1 }),
      makeOffer({ price: 140, sold_recent: 2 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.archetype.archetype).toBe('VOLUME_DRIVEN');
  });

  test('produces a recommendation per seller', () => {
    const offers = [
      makeOffer({ seller: 'sellerA', price: 100, sold_recent: 10 }),
      makeOffer({ seller: 'sellerB', price: 150, sold_recent: 2 }),
      makeOffer({ seller: 'sellerC', price: 200, sold_recent: 0 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.recommendations).toHaveLength(3);
    const sellerA = result.recommendations.find(r => r.seller === 'sellerA');
    expect(sellerA).toBeDefined();
    expect(sellerA!.scorecard.score).toBeGreaterThan(0);
  });

  test('cheapest seller with most sales gets highest score', () => {
    const offers = [
      makeOffer({ seller: 'best', price: 99, sold_recent: 50, recommend_pct: 98 }),
      makeOffer({ seller: 'mid', price: 120, sold_recent: 10, recommend_pct: 90 }),
      makeOffer({ seller: 'worst', price: 180, sold_recent: 0, recommend_pct: 70 }),
    ];
    const result = buildAnalysisResult(offers);
    const best = result.recommendations.find(r => r.seller === 'best')!;
    const worst = result.recommendations.find(r => r.seller === 'worst')!;
    expect(best.scorecard.score).toBeGreaterThan(worst.scorecard.score);
  });
});

describe('buildAnalysisResult — edge cases', () => {
  test('returns UNKNOWN for empty offers array', () => {
    const result = buildAnalysisResult([]);
    expect(result.archetype.archetype).toBe('UNKNOWN');
    expect(result.market.total_offers).toBe(0);
    expect(result.recommendations).toHaveLength(0);
  });

  test('returns UNKNOWN for single offer', () => {
    const result = buildAnalysisResult([makeOffer({ price: 100 })]);
    expect(result.archetype.archetype).toBe('UNKNOWN');
  });

  test('handles all-zero sold_recent without false PRICE_THRESHOLD', () => {
    const offers = [
      makeOffer({ price: 100, sold_recent: 0 }),
      makeOffer({ price: 200, sold_recent: 0 }),
      makeOffer({ price: 300, sold_recent: 0 }),
    ];
    const result = buildAnalysisResult(offers);
    // With no sales anywhere, should not classify as PRICE_THRESHOLD
    expect(result.archetype.archetype).not.toBe('PRICE_THRESHOLD');
  });

  test('handles identical prices', () => {
    const offers = [
      makeOffer({ price: 100, sold_recent: 5 }),
      makeOffer({ price: 100, sold_recent: 3 }),
      makeOffer({ price: 100, sold_recent: 1 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.market.price_min).toBe(100);
    expect(result.market.price_max).toBe(100);
    expect(result.market.price_median).toBe(100);
  });
});

describe('buildAnalysisResult — archetype detection', () => {
  test('detects PAY_TO_PLAY when >40% offers are sponsored', () => {
    // 3 of 5 offers sponsored (60%) — sponsoredPct > 0.4 triggers PAY_TO_PLAY
    // Sales spread evenly so VOLUME_DRIVEN (top3 > 60% of total) does not fire:
    //   top3 = 5+5+4 = 14, total = 5+5+4+3+3 = 20, 14/20 = 70% — that would still trigger VOLUME_DRIVEN
    // So give all sellers equal sales (or zero) to avoid that — 0 sales means totalSales=0,
    // which means VOLUME_DRIVEN guard (totalSales > 0) never fires.
    const offers = [
      makeOffer({ badges: { ...BASE_BADGES, sponsored: true }, sold_recent: 0 }),
      makeOffer({ badges: { ...BASE_BADGES, sponsored: true }, sold_recent: 0 }),
      makeOffer({ badges: { ...BASE_BADGES, sponsored: true }, sold_recent: 0 }),
      makeOffer({ badges: { ...BASE_BADGES, sponsored: false }, sold_recent: 0 }),
      makeOffer({ badges: { ...BASE_BADGES, sponsored: false }, sold_recent: 0 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.archetype.archetype).toBe('PAY_TO_PLAY');
  });

  test('detects PRICE_THRESHOLD when sales drop to zero above a price cliff', () => {
    // Spread sales across many sellers below the cliff so top-3 share < 60% of total.
    // Low side: 6 sellers with 5 sales each = 30 total; top3 = 15 → 15/30 = 50% < 60% ✓
    // High side: 0 sales, big gap (100 → 200).
    const offers = [
      makeOffer({ price: 100, sold_recent: 5 }),
      makeOffer({ price: 102, sold_recent: 5 }),
      makeOffer({ price: 104, sold_recent: 5 }),
      makeOffer({ price: 106, sold_recent: 5 }),
      makeOffer({ price: 108, sold_recent: 5 }),
      makeOffer({ price: 110, sold_recent: 5 }),
      makeOffer({ price: 200, sold_recent: 0 }),  // big gap, no sales above
      makeOffer({ price: 210, sold_recent: 0 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.archetype.archetype).toBe('PRICE_THRESHOLD');
  });

  test('returns MIXED when no single archetype dominates', () => {
    // 6 sellers with equal sales → top3 = 3*5 = 15, total = 6*5 = 30, 15/30 = 50% < 60% → no VOLUME_DRIVEN
    // No sponsoring → no PAY_TO_PLAY
    // Similar prices → no PRICE_THRESHOLD gap >15%
    // Low stddev → detectPriceTiers returns 1 → no PRICE_TIERED
    const offers = [
      makeOffer({ price: 100, sold_recent: 5 }),
      makeOffer({ price: 101, sold_recent: 5 }),
      makeOffer({ price: 102, sold_recent: 5 }),
      makeOffer({ price: 103, sold_recent: 5 }),
      makeOffer({ price: 104, sold_recent: 5 }),
      makeOffer({ price: 105, sold_recent: 5 }),
    ];
    const result = buildAnalysisResult(offers);
    expect(result.archetype.archetype).toBe('MIXED');
  });
});
