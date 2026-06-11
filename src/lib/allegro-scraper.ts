/**
 * Allegro scraper — wraps Firecrawl and parses Allegro HTML.
 *
 * scrapeAllegroPage(url)     → fetches HTML via FirecrawlPool
 * extractAggregatorUrl(html) → finds the /oferty-produktu/ comparison URL from an offer page
 * parseAllegroOffers(html)   → extracts offer list from a /oferty-produktu/ page
 *
 * === METODA WYSZUKIWANIA KONKURENCJI ===
 *
 * Scraper wykorzystuje panel boczny "Ten produkt od innych sprzedających"
 * widoczny na stronie oferty głównej. Panel ten zawiera link do pełnej
 * listy ofert (przycisk "WSZYSTKIE OFERTY (N)"), prowadzący do strony
 * /oferty-produktu/slug-uuid.
 *
 * Ekstrakcja URL agregatora odbywa się z wielu źródeł (w kolejności priorytetu):
 *   1. Link z panelu bocznego: href="/oferty-produktu/..."
 *   2. Link kanoniczny: <link rel="canonical" href="/produkt/..."> → konwertowany na /oferty-produktu/
 *   3. Dane JSON opbox: productId z konfiguracji → budowany URL agregatora
 *
 * Dzięki temu mamy 100% pewność, że pobieramy oferty z tego samego
 * produktu w katalogu Allegro (produktyzacja).
 */
import type { Offer } from '@/types/api';
import { randomUUID } from 'crypto';
import { ScrapeGraphPool, PoolKey } from './scrapegraph-pool';

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

const SGAI_KEYS_ENV = process.env.SCRAPEGRAPH_API_KEYS ?? '';
let sgaiPool: ScrapeGraphPool | null = null;

export function getPool(): ScrapeGraphPool {
  if (!sgaiPool) {
    if (!SGAI_KEYS_ENV) {
      console.warn('[allegro-scraper] No SCRAPEGRAPH_API_KEYS defined in env. Scrapes may fail.');
    }
    const keys: PoolKey[] = ScrapeGraphPool.parseEnvKeys(SGAI_KEYS_ENV);
    sgaiPool = new ScrapeGraphPool({ keys });
  }
  return sgaiPool;
}

/**
 * Scrape an Allegro page via Firecrawl. Returns raw HTML.
 * Uses proxy:stealth which successfully bypasses Allegro's bot detection on valid URLs.
 */
export async function scrapeAllegroPage(url: string, mobile = false): Promise<string> {
  const pool = getPool();
  let attempt = 0;
  const maxRetries = 4; // Zwiększone próby w razie CAPTCHA

  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await pool.scrape({
        url,
        // Używamy ScrapeGraphAI bez renderowania JS dla szybkości lub auto dla omijania blokad.
        // Konfigurację anty-bot możemy przekazać (SDK może mieć 'proxy' lub inne opcje):
        proxy: 'advanced', // Przykładowo dla ScrapeGraphAI proxy/stealth
        headers: {
          'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
          'User-Agent': mobile 
             ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
             : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        }
      });

      const html = response.html ?? '';
      
      if (html.includes('Captcha') && html.includes('reCAPTCHA') && html.includes('allegro.pl')) {
        console.warn(`[scrapeAllegroPage] CAPTCHA detected for ${url}. Retrying (${attempt}/${maxRetries})...`);
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      
      return html;
    } catch (e: any) {
      if (attempt >= maxRetries) throw e;
      console.warn(`[scrapeAllegroPage] Error: ${e.message}. Retrying (${attempt}/${maxRetries})...`);
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
 * Uses THREE sources in priority order for 100% reliability:
 *
 * 1. Direct link from the sidebar panel "Ten produkt od innych sprzedających"
 *    or from the "PORÓWNAJ X OFERT TEGO PRODUKTU" button.
 *    Pattern: href="https://allegro.pl/oferty-produktu/slug-uuid..."
 *
 * 2. Canonical link <link rel="canonical" href="/produkt/slug-uuid">
 *    This is always present on offer pages and contains the product UUID.
 *    We convert /produkt/ → /oferty-produktu/ to build the aggregator URL.
 *
 * 3. JSON config data embedded in the page (opbox config / dataLayer)
 *    Contains productId which can be used to construct the aggregator URL.
 *
 * Returns the full URL or null if not found (product not in Allegro's catalog).
 */
export function extractAggregatorUrl(html: string): string | null {
  // ── Source 1: Direct /oferty-produktu/ link ──────────────────────────────
  // This is the most reliable — it's the exact URL from the sidebar panel
  // "Ten produkt od innych sprzedających" → "WSZYSTKIE OFERTY (N)"
  // or from the "PORÓWNAJ X OFERT TEGO PRODUKTU" button.
  const directMatch = html.match(/href="(https:\/\/allegro\.pl\/oferty-produktu\/[^"]+)"/);
  if (directMatch) {
    console.log(`[extractAggregatorUrl] Znaleziono bezpośredni link do agregatora z panelu bocznego`);
    return directMatch[1];
  }

  // ── Source 2: Canonical /produkt/ URL → convert to /oferty-produktu/ ─────
  // <link rel="canonical" href="https://allegro.pl/produkt/slug-uuid">
  // The /produkt/ and /oferty-produktu/ pages share the same slug-uuid.
  const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="(https:\/\/allegro\.pl\/produkt\/[^"]+)"/i);
  if (canonicalMatch) {
    const produktUrl = canonicalMatch[1];
    // Extract slug from /produkt/slug → build /oferty-produktu/slug
    const slug = produktUrl.replace('https://allegro.pl/produkt/', '');
    const aggUrl = `https://allegro.pl/oferty-produktu/${slug}`;
    console.log(`[extractAggregatorUrl] Zbudowano URL agregatora z linku kanonicznego: ${aggUrl}`);
    return aggUrl;
  }

  // ── Source 3: productId from JSON config ─────────────────────────────────
  // Allegro embeds productId (UUID) in opbox config and dataLayer.
  // Pattern: "productId":"e2e8c06b-a38f-4f28-ad82-a0d5db19e51c"
  const productIdMatch = html.match(/"productId"\s*:\s*"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"/i);
  if (productIdMatch) {
    // We need the slug too. Try to find it from the page title or other sources.
    // The product page URL itself may have the slug.
    const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim().replace(/ - Allegro\.pl$/i, '') : '';
    // Build a rough slug from the title
    const slug = title
      .toLowerCase()
      .replace(/[ąáàâã]/g, 'a').replace(/[ćč]/g, 'c').replace(/[ęéèêë]/g, 'e')
      .replace(/[ìíîï]/g, 'i').replace(/[łl]/g, 'l').replace(/[ńñ]/g, 'n')
      .replace(/[óòôõö]/g, 'o').replace(/[śš]/g, 's').replace(/[üùúû]/g, 'u')
      .replace(/[żźž]/g, 'z')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      + '-' + productIdMatch[1];
    const aggUrl = `https://allegro.pl/oferty-produktu/${slug}`;
    console.log(`[extractAggregatorUrl] Zbudowano URL agregatora z productId: ${aggUrl}`);
    return aggUrl;
  }

  console.log(`[extractAggregatorUrl] Nie znaleziono linku do agregatora — produkt prawdopodobnie nie jest w katalogu Allegro`);
  return null;
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
  result.stock = stockMatch ? (stockMatch[1] ? parseInt(stockMatch[1]) : 1) : undefined;
  
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
  result.rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : undefined;
  
  const cats = $('[data-role="breadcrumb-item"]').map((i, el) => $(el).text().trim()).get();
  result.mainCategory = cats.length > 1 ? cats[1] : 'Brak kategorii';
  result.subCategory = cats.length > 2 ? cats[2] : 'Brak podkategorii';

  return result;
}

/**
 * Extract summary data from the sidebar panel "Ten produkt od innych sprzedających"
 * that appears on the main offer page. This panel is often lazy-loaded, so data
 * may not always be available in static HTML.
 *
 * Returns: { totalOffers, cheapestPrice, cheapestSeller, highestPrice, highestSeller }
 */
export function extractSidebarCompetitorSummary(html: string): {
  totalOffers?: number;
  cheapestPrice?: number;
  cheapestSeller?: string;
  highestPrice?: number;
  highestSeller?: string;
} | null {
  // Try to find "WSZYSTKIE OFERTY (N)" to get total count
  const totalMatch = html.match(/WSZYSTKIE\s+OFERTY\s*\((\d+)\)/i) 
    || html.match(/wszystkie\s+oferty\s*\((\d+)\)/i)
    || html.match(/Porównaj\s+(\d+)\s+ofert/i)
    || html.match(/PORÓWNAJ\s+(\d+)\s+OFERT/i);
  
  if (!totalMatch) return null;

  return {
    totalOffers: parseInt(totalMatch[1]),
  };
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
    normalized.match(/(\d+)\s+osob[a-zżółćęśąź]*\s+kupi/i) ??
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
      
    // ── Price with Delivery ───────────────────────────────────────────────────
    // "75,28 zł z dostawą"
    const totalDeliveryMatch = body.match(/(\d+)[.,](\d{2})\s*z[łl]\s+z\s+dostaw[aą]/i);
    const total_with_delivery = totalDeliveryMatch
      ? parseFloat(`${totalDeliveryMatch[1]}.${totalDeliveryMatch[2]}`)
      : undefined;

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
