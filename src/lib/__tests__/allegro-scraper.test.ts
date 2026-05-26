import { describe, test, expect } from 'vitest';
import { parseAllegroOffers, extractAggregatorUrl } from '../allegro-scraper';

/**
 * Minimal HTML that mirrors the real Allegro /oferty-produktu/ structure (May 2026).
 *
 * Key fields:
 *  - Offer ID lives in ?offerId=NNNNN query params on /produkt/ links
 *  - Price is in aria-label="NNN,NN&nbsp;zł aktualna cena"
 *  - Seller name follows the "od" text node pattern
 *  - Rating follows "Poleca sprzedającego:" text
 */
const makeArticle = ({
  offerId,
  seller,
  price,        // Polish format: "879,00"
  pct,          // e.g. "97,3"
  reviews,
  sold,
  smart = false,
  topOffer = false,
  sponsored = false,
  firma = false,
}: {
  offerId: string;
  seller: string;
  price: string;
  pct?: string;
  reviews?: number;
  sold?: number;
  smart?: boolean;
  topOffer?: boolean;
  sponsored?: boolean;
  firma?: boolean;
}) => `
<article class="mx7m_1 _1e32a_kdIMd">
  ${topOffer ? '<p style="background-color:orange">Top oferta</p>' : ''}
  ${sponsored ? '<p class="mpof_vs">Sponsorowane</p>' : ''}
  <a href="https://allegro.pl/produkt/sluchawki-airpods-pro-abc123?offerId=${offerId}" rel="nofollow">
    <img alt="Apple AirPods Pro" src="https://a.allegroimg.com/s180/abc/img">
  </a>
  <div class="mh36_8 mjyo_6x">
    <div class="_1e32a_qDdj-">
      ${firma ? '<p class="mgmw_3z">Firma</p>' : ''}
    </div>
    <div class="_1e32a_meWPT">
      <div class="mpof_ki">
        <div class="m3h2_4 mgn2_12">od</div>
        <p class="mgn2_12 mp4t_0"><span class="mgmw_wo">${seller}</span></p>
      </div>
      ${pct !== undefined ? `<p class="mgn2_12">Poleca sprzedającego: <span class="mgmw_wo">${pct}%</span></p>` : ''}
      ${reviews !== undefined ? `<p class="mgn2_12">${reviews} ocen</p>` : ''}
      <h2 class="mqu1_16">
        <a href="https://allegro.pl/produkt/sluchawki-airpods-pro-abc123?offerId=${offerId}">Apple AirPods Pro</a>
      </h2>
      ${sold !== undefined ? `<span>${sold} osób kupiło</span>` : ''}
      <div class="msa3_z4 m3h2_8">
        <p aria-label="${price}&nbsp;zł aktualna cena" tabindex="0">
          <span>${price}&nbsp;<span>zł</span></span>
        </p>
        ${smart ? '<button aria-label="Allegro Smart! szczegóły"><img alt="Smart!" src="smart.svg"></button>' : ''}
      </div>
    </div>
  </div>
</article>`;

const FIXTURE_HTML = [
  makeArticle({ offerId: '17758803293', seller: 'GoldGame2', price: '907,90', pct: '97,3', reviews: 9541, sold: 3, smart: true }),
  makeArticle({ offerId: '17677360814', seller: 'quikset',   price: '929,00', pct: '88,1', reviews: 126,  sold: 1 }),
  makeArticle({ offerId: '17087452708', seller: 'OleOlepl',  price: '879,00', pct: '96,0', reviews: 2000, topOffer: true, firma: true }),
].join('\n');

describe('parseAllegroOffers', () => {
  test('extracts correct offer count', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers).toHaveLength(3);
  });

  test('extracts offer ID and seller name', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].offer_id).toBe('17758803293');
    expect(offers[0].seller).toBe('GoldGame2');
    expect(offers[1].offer_id).toBe('17677360814');
    expect(offers[1].seller).toBe('quikset');
  });

  test('extracts price in decimal format', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].price).toBe(907.90);
    expect(offers[1].price).toBe(929.00);
    expect(offers[2].price).toBe(879.00);
  });

  test('extracts recommend_pct', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].recommend_pct).toBeCloseTo(97.3);
    expect(offers[1].recommend_pct).toBeCloseTo(88.1);
  });

  test('extracts review count', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].reviews).toBe(9541);
    expect(offers[1].reviews).toBe(126);
  });

  test('extracts sold count', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].sold_recent).toBe(3);
    expect(offers[1].sold_recent).toBe(1);
    expect(offers[2].sold_recent).toBe(0); // not set
  });

  test('detects Smart badge', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].badges.smart).toBe(true);
    expect(offers[1].badges.smart).toBe(false);
  });

  test('detects Top oferta badge', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[2].badges.top_offer).toBe(true);
    expect(offers[0].badges.top_offer).toBe(false);
  });

  test('detects Firma badge', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[2].badges.firma).toBe(true);
    expect(offers[0].badges.firma).toBe(false);
  });

  test('detects Sponsored badge', () => {
    const sponsored = makeArticle({ offerId: '99999', seller: 'adSeller', price: '999,00', sponsored: true });
    const offers = parseAllegroOffers(sponsored);
    expect(offers[0].badges.sponsored).toBe(true);
  });

  test('handles Polish thousands separator in sold count', () => {
    const html = makeArticle({ offerId: '11111111', seller: 'bigSeller', price: '99,99', sold: undefined });
    const withThousands = html.replace('</article>', '<span>1 000 osób kupiło</span></article>');
    const offers = parseAllegroOffers(withThousands);
    expect(offers[0].sold_recent).toBe(1000);
  });

  test('skips articles without offerId', () => {
    const noOfferId = '<article class="other"><p>Not an offer</p></article>';
    const offers = parseAllegroOffers(noOfferId + FIXTURE_HTML);
    expect(offers).toHaveLength(3);
  });

  test('builds offer URL from offerId', () => {
    const offers = parseAllegroOffers(FIXTURE_HTML);
    expect(offers[0].offer_url).toContain('offerId=17758803293');
  });
});

describe('extractAggregatorUrl', () => {
  test('extracts /oferty-produktu/ URL from offer page HTML', () => {
    const html = `
      <html>
        <a href="https://allegro.pl/oferty-produktu/sluchawki-apple-uuid?ocoi=token123" itemprop="item">
          Porównaj ceny
        </a>
      </html>
    `;
    const url = extractAggregatorUrl(html);
    expect(url).toBe('https://allegro.pl/oferty-produktu/sluchawki-apple-uuid?ocoi=token123');
  });

  test('extracts /oferty-produktu/ URL without query string', () => {
    const html = `
      <a href="https://allegro.pl/oferty-produktu/product-slug-uuid123">Compare</a>
    `;
    const url = extractAggregatorUrl(html);
    expect(url).toBe('https://allegro.pl/oferty-produktu/product-slug-uuid123');
  });

  test('returns null when no aggregator URL present', () => {
    const html = '<html><a href="https://allegro.pl/oferta/product-123">Offer</a></html>';
    expect(extractAggregatorUrl(html)).toBeNull();
  });
});
