/**
 * Allegro scraper — wraps Firecrawl and parses Allegro HTML.
 *
 * scrapeAllegroPage(url)     → fetches HTML via FirecrawlPool
 * extractAggregatorUrl(html) → finds the /oferty-produktu/ comparison URL from an offer page
 * parseAllegroOffers(html)   → extracts offer list from a /oferty-produktu/ page
 *
 * HTML structure (Allegro as of May 2026):
 *  - Each seller entry is an <article> element
 *  - Offer ID lives in ?offerId=NNNNN query params on /produkt/ links
 *  - Price is in aria-label="NNN,NN&nbsp;zł aktualna cena" on a <p>
 *  - Seller name follows the text node "od" → next <span>
 *  - Rating: "Poleca sprzedającego: XX,X%" → next <span>
 *  - Reviews: "NNNNN ocen"
 *  - Sold: "N osób/osoby/osoba kupiło/kupiły/kupiła"
 */
import type { Offer } from '@/types/api';
import { randomUUID } from 'crypto';
import { FirecrawlPool } from './firecrawl-pool';
import { createServiceClient } from './db';
import * as cheerio from 'cheerio';

export interface SingleOfferData {
  url: string;
  title: string;
  price?: number;
  price_with_delivery?: number;
  condition?: string;
  stock?: number;
  sold_recent?: number;
  seller?: string;
  smart?: boolean;
  delivery_date?: string;
  shipping_time?: string;
  warranty?: string;
  super_seller?: boolean;
  super_price?: boolean;
  reviews?: number;
  rating?: number;
  mainCategory?: string;
  subCategory?: string;
}

let _pool: FirecrawlPool | null = null;

async function getPool(): Promise<FirecrawlPool> {
  if (!_pool) {
    const raw = process.env.FIRECRAWL_API_KEYS ?? '';
    if (!raw) throw new Error('FIRECRAWL_API_KEYS env var is required');
    _pool = new FirecrawlPool({
      db: process.env.LOCAL_SCRAPE === 'true' ? null : createServiceClient(),
      keys: FirecrawlPool.parseEnvKeys(raw),
    });
    await _pool.loadUsage();
  }
  return _pool;
}

/**
 * Scrape an Allegro page via Firecrawl. Returns raw HTML.
 * Uses proxy:stealth which successfully bypasses Allegro's bot detection on valid URLs.
 */
export async function scrapeAllegroPage(url: string, retries = 3): Promise<string> {
  const pool = await getPool();
  
  for (let i = 0; i < retries; i++) {
    try {
      const result = await pool.scrape({
        url,
        formats: ['rawHtml'],
        proxy: 'stealth',
        waitFor: 5000,
      });
      
      const html = (result.rawHtml ?? result.html ?? '') as string;
      
      if (html.includes('Captcha') && html.includes('reCAPTCHA') && html.includes('allegro.pl')) {
        console.warn(`[scrapeAllegroPage] CAPTCHA detected for ${url}. Retrying (${i + 1}/${retries})...`);
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        continue;
      }
      
      return html;
    } catch (e: any) {
      if (i === retries - 1) throw e;
      console.warn(`[scrapeAllegroPage] Error: ${e.message}. Retrying (${i + 1}/${retries})...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
  
  throw new Error('Allegro CAPTCHA blocked the request after multiple retries.');
}

// ─── Aggregator URL discovery ─────────────────────────────────────────────────

/**
 * Given the HTML of a single Allegro offer page (/oferta/slug-id), find the
 * product-comparison aggregator URL (/oferty-produktu/...) that lists all sellers.
 *
 * Returns the full URL (possibly with ?ocoi=... query) or null if not found.
 */
export function extractAggregatorUrl(html: string): string | null {
  // The comparison page link appears as:
  //   href="https://allegro.pl/oferty-produktu/slug-uuid" or
  //   href="https://allegro.pl/oferty-produktu/slug-uuid?ocoi=token"
  const m = html.match(/href="(https:\/\/allegro\.pl\/oferty-produktu\/[^"]+)"/);
  return m ? m[1] : null;
}

// ─── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Parse a single Allegro offer page (the main product page).
 */
export function parseAllegroSingleOffer(html: string, url: string): SingleOfferData {
  const $ = cheerio.load(html);
  const result: SingleOfferData = { url, title: '' };
  
  result.title = $('h1').first().text().trim() || $('title').text().replace(' - Allegro.pl', '').trim();
  
  // Price
  const priceMatchJson = html.match(/"price":\s*\{\s*"formattedPrice"\s*:\s*"([\d,\s]+)/i);
  const priceMatchMeta = html.match(/za\s+([\d.]+)\s*PLN/i) || html.match(/za\s+([\d,]+)(?:&nbsp;|\s)*zł/i);
  
  if (priceMatchJson) {
      result.price = parseFloat(priceMatchJson[1].replace(/\s/g, '').replace(',', '.'));
  } else if (priceMatchMeta) {
      result.price = parseFloat(priceMatchMeta[1].replace(',', '.'));
  }

  // Condition
  const conditionMatch = html.match(/Stan[\s\S]{0,50}?<div[^>]*>([^<]+)<\/div>/i) || html.match(/"condition":"([^"]+)"/i);
  result.condition = conditionMatch ? conditionMatch[1].trim() : 'Nowy';
  if (result.condition.length > 20) result.condition = 'Nowy'; // fallback
  
  // Stock
  const stockMatch = html.match(/z (\d+) sztuk/i) || html.match(/Dostępn[ae] (\d+) sztuk/i) || html.match(/ostatnia sztuka/i);
  result.stock = stockMatch ? (stockMatch[1] ? parseInt(stockMatch[1]) : 1) : null;
  
  // Sold Recent
  const soldMatch = html.match(/(\d+)\s+osob[ay]?\s+kupi[łl][yo]\s+tę ofertę/i) || html.match(/(\d+)\s+osob[ay]?\s+kupi[łl][yo]/i);
  result.sold_recent = soldMatch ? parseInt(soldMatch[1]) : 0;
  
  // Seller
  const sellerMatchJson = html.match(/"seller":\{[^}]*"login":"([^"]+)"/i);
  if (sellerMatchJson) {
      result.seller = sellerMatchJson[1];
  } else {
      const sellerDiv = $('div:contains("Sprzedaż i wysyłka")').parent().find('a[href*="/uzytkownik/"]').first();
      result.seller = sellerDiv.text().trim() || 'unknown';
  }
  
  result.smart = /alt="Smart!"|Allegro Smart!/i.test(html);
  
  // Delivery cost and Price with delivery
  const deliveryCostMatch = html.match(/"deliveryCost":"([^"]+)"/i);
  if (deliveryCostMatch) {
      if (deliveryCostMatch[1].toLowerCase().includes('darmowa')) {
          result.price_with_delivery = result.price;
      } else {
          const cost = parseFloat(deliveryCostMatch[1].replace(',', '.').replace(/[^\d.]/g, ''));
          if (!isNaN(cost) && result.price) {
              result.price_with_delivery = result.price + cost;
          }
      }
  } else if (result.price) {
      // Fallback
      result.price_with_delivery = result.price;
  }
  
  // Delivery Date (Kiedy dostawa)
  const deliveryMatch = html.match(/(?:Przewidywana dostawa|dostawa) (dzisiaj|jutro|pojutrze|w [^<]+|pon\.|wt\.|śr\.|czw\.|pt\.|sob\.|niedz\.)/i);
  result.delivery_date = deliveryMatch ? deliveryMatch[0] : 'Brak informacji';
  
  // Shipping Time (Czas wysyłki)
  const dispatchMatch = html.match(/"dispatchTime":\s*"([^"]+)"/i) || html.match(/wysyłka\s+(dzisiaj|w \d+\s*h|jutro)/i);
  result.shipping_time = dispatchMatch ? dispatchMatch[1] || dispatchMatch[0] : 'Brak informacji';
  
  // Warranty (Gwarancja)
  const warrantyMatch = html.match(/"name":"Gwarancja","values":\["([^"]+)"\]/i) || html.match(/"name":"Stan",[^}]*"name":"Gwarancja","values":\["([^"]+)"\]/i) || html.match(/"name":"Rękojmia","values":\["([^"]+)"\]/i);
  result.warranty = warrantyMatch ? warrantyMatch[1] : 'Brak informacji';
  
  // Super Seller
  const superSellerMatch = html.match(/"superSeller":\s*(true|false)/i) || html.match(/Super Sprzedawca/i);
  result.super_seller = superSellerMatch ? (superSellerMatch[1] === 'true' || superSellerMatch[0] === 'Super Sprzedawca') : false;
  
  // Supercena
  result.super_price = /Supercena/i.test(html);
  
  const reviewMatch = html.match(/(\d[\d\s]*)\s+ocen(?:y|i)?\b/i);
  result.reviews = reviewMatch ? parseInt(reviewMatch[1].replace(/\s/g, '')) : 0;
  
  const ratingMatch = html.match(/Średnia ocen ([\d,]+) na 5/i) || html.match(/Poleca\s*([\d,]+)%/i);
  result.rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;
  
  const cats = $('[data-role="breadcrumb-item"]').map((i, el) => $(el).text().trim()).get();
  result.mainCategory = cats.length > 1 ? cats[1] : 'Brak kategorii';
  result.subCategory = cats.length > 2 ? cats[2] : 'Brak podkategorii';

  return result;
}

/**
 * Polish grammar for "X people bought recently":
 *   1 osoba kupiła    (1 sale)
 *   2-4 osoby kupiły  (2-4 sales)
 *   5+ osób kupiło    (5+ sales)
 * Allegro uses spaces as thousands separators: "1 000", "10 000"
 */
function extractSoldCount(text: string): number {
  // Normalize thousands separator first: "1 000" → "1000"
  const normalized = text.replace(/(\d) (\d)/g, '$1$2');
  const m =
    normalized.match(/(\d+)\s+osob[ay]?\s+kupi/i) ??
    normalized.match(/(\d+)\s+osoba\s+kupi[łl]a/i) ??
    normalized.match(/(\d+)\s+osoby\s+kupi[łl]y/i) ??
    normalized.match(/(\d+)\s+osób\s+kupi[łl]o/i);
  return m ? parseInt(m[1], 10) : 0;
}

/**
 * Parse seller offers from an Allegro /oferty-produktu/ comparison page.
 *
 * Each <article> element is one seller's listing.  Uses regex rather than a
 * DOM library to keep dependencies minimal; patterns are anchored to stable
 * semantic text (aria-labels, Polish UI strings) rather than obfuscated
 * class names that Allegro rotates with each deploy.
 */
export function parseAllegroOffers(html: string): Offer[] {
  const offers: Offer[] = [];
  const articlePattern = /<article([^>]*)>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;

  while ((match = articlePattern.exec(html)) !== null) {
    const body = match[2];

    // ── Offer ID ──────────────────────────────────────────────────────────────
    // Allegro embeds the offer ID in ?offerId=NNNNN query params on /produkt/ links.
    // Articles without this are not seller-offer cards (skip them).
    const offerIdMatch = body.match(/\?offerId=(\d+)/);
    if (!offerIdMatch) continue;
    const offer_id = offerIdMatch[1];

    // ── Offer URL ─────────────────────────────────────────────────────────────
    // Most articles link to /produkt/slug-uuid?offerId=NNN (canonical comparison URL).
    // Sponsored articles may use a click-tracking redirect; fall back to /oferta/ URL.
    const offerUrlMatch =
      body.match(/href="(https:\/\/allegro\.pl\/produkt\/[^"]*\?offerId=\d+[^"]*)"/) ??
      body.match(/href="(https:\/\/allegro\.pl\/oferta\/[^"?]+)"/);
    const offer_url = offerUrlMatch?.[1];

    // ── Title ─────────────────────────────────────────────────────────────────
    // Prefer the <h2>→<a> text; fall back to the product image alt.
    const titleMatch =
      body.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i) ??
      body.match(/alt="([^"]+)" src="https:\/\/a\.allegroimg\.com/);
    const title = titleMatch?.[1]?.trim() ?? '';

    // ── Seller name ───────────────────────────────────────────────────────────
    // Pattern: <div …>od</div> … <span …>SELLER_NAME</span>
    const sellerMatch = body.match(/>od<\/div>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
    const seller = sellerMatch?.[1]?.trim() ?? 'unknown';

    // ── Price ─────────────────────────────────────────────────────────────────
    // aria-label="879,00&nbsp;zł aktualna cena"  (Polish decimal comma, HTML entity for NBSP)
    const priceMatch = body.match(/aria-label="(\d+),(\d{2})&nbsp;z[^"]*aktualna cena"/i);
    const price = priceMatch
      ? parseFloat(`${priceMatch[1]}.${priceMatch[2]}`)
      : 0;

    // ── Recommend percent ─────────────────────────────────────────────────────
    // "Poleca sprzedającego: <span>97,3%</span>"
    const recommendMatch = body.match(/Poleca sprzedaj[^:]*:[\s\S]*?<span[^>]*>([\d]+[,.][\d]+)%<\/span>/i);
    const recommend_pct = recommendMatch
      ? parseFloat(recommendMatch[1].replace(',', '.'))
      : undefined;

    // ── Reviews ───────────────────────────────────────────────────────────────
    const reviewMatch = body.match(/(\d[\d\s]*)\s+ocen(?:y|i)?\b/i) ??
      body.match(/(\d[\d\s]*)\s+opini/i);
    const reviews = reviewMatch
      ? parseInt(reviewMatch[1].replace(/\s/g, ''), 10)
      : undefined;

    // ── Sold count ────────────────────────────────────────────────────────────
    const sold_recent = extractSoldCount(body);

    // ── Badges ────────────────────────────────────────────────────────────────
    const badges = {
      smart:          /alt="Smart!"|Allegro Smart!/i.test(body),
      super_seller:   /super\s+sprzedawca/i.test(body),
      top_offer:      /Top oferta/i.test(body),
      contains_promo: /promo|rabat|obni[żz]/i.test(body),
      sponsored:      /Sponsorowane/i.test(body),
      firma:          />Firma</i.test(body),
      official_store: /oficjalny\s+sklep/i.test(body),
    };

    offers.push({
      id: randomUUID(),
      offer_id,
      seller,
      title,
      offer_url,
      price,
      recommend_pct,
      reviews,
      sold_recent,
      badges,
    });
  }

  return offers;
}
