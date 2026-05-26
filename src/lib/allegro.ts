/**
 * Detects what kind of input a user pasted and normalises it.
 *
 * Accepts:
 *  - An Allegro offer URL: https://allegro.pl/oferta/some-slug-12345678
 *  - An Allegro product page URL: https://allegro.pl/produkt/some-slug-uuid
 *  - An Allegro offers aggregator URL: https://allegro.pl/oferty-produktu/...?ocoi=...
 *  - A bare EAN: 8 or 13-digit numeric string
 *  - "auto" mode: infer based on the input
 *
 * Returns the canonical resolved fields the rest of the pipeline relies on.
 */

export interface ResolvedInput {
  kind: 'allegro_offer' | 'allegro_product' | 'allegro_aggregator' | 'ean' | 'unknown';
  /** Original user input, trimmed */
  raw: string;
  /** Parsed EAN if available (8-14 digits) */
  ean?: string;
  /** Allegro offerId if available (from /oferta/...-NNNNN URLs) */
  offer_id?: string;
  /** Allegro product UUID if available (from /produkt/<slug>-<uuid>) */
  product_uuid?: string;
  /** OCOI session token if pasted directly */
  ocoi?: string;
  /** Best-effort normalized URL for further scraping */
  normalized_url?: string;
}

const EAN_RE = /^\d{8,14}$/;
const OFFER_URL_RE = /allegro\.pl\/oferta\/[A-Za-z0-9\-]+/i;
const PRODUCT_URL_RE = /allegro\.pl\/produkt\/[A-Za-z0-9\-]+/i;
const AGGREGATOR_URL_RE = /allegro\.pl\/oferty-produktu\/[A-Za-z0-9\-]+/i;
const OFFER_ID_RE = /\/oferta\/[A-Za-z0-9\-]+?-(\d{6,})/i;
const PRODUCT_UUID_RE = /\/produkt\/[A-Za-z0-9\-]+?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const OCOI_QUERY_RE = /[?&]ocoi=([^&\s]+)/i;
const OFFER_ID_QUERY_RE = /[?&]offerId=(\d+)/i;

/**
 * Detect the kind of input + extract structured fields where possible.
 */
export function parseAllegroInput(rawInput: string): ResolvedInput {
  const raw = rawInput.trim();

  // Bare EAN (8-14 digits)
  if (EAN_RE.test(raw)) {
    return { kind: 'ean', raw, ean: raw };
  }

  // Offer URL
  if (OFFER_URL_RE.test(raw)) {
    const offerIdMatch = raw.match(OFFER_ID_RE);
    return {
      kind: 'allegro_offer',
      raw,
      offer_id: offerIdMatch?.[1],
      normalized_url: raw.split('?')[0],
    };
  }

  // Product page URL
  if (PRODUCT_URL_RE.test(raw)) {
    const uuidMatch = raw.match(PRODUCT_UUID_RE);
    const offerIdMatch = raw.match(OFFER_ID_QUERY_RE);
    return {
      kind: 'allegro_product',
      raw,
      product_uuid: uuidMatch?.[1],
      offer_id: offerIdMatch?.[1],
      normalized_url: raw.split('?')[0],
    };
  }

  // Aggregator URL with OCOI token
  if (AGGREGATOR_URL_RE.test(raw)) {
    const uuidMatch = raw.match(PRODUCT_UUID_RE);
    const ocoiMatch = raw.match(OCOI_QUERY_RE);
    return {
      kind: 'allegro_aggregator',
      raw,
      product_uuid: uuidMatch?.[1],
      ocoi: ocoiMatch?.[1],
      normalized_url: raw,
    };
  }

  return { kind: 'unknown', raw };
}

/**
 * Map the parsed kind to our API input_type enum.
 */
export function inputTypeFromKind(kind: ResolvedInput['kind']): 'allegro_url' | 'ean' | 'product_url' | 'auto' {
  switch (kind) {
    case 'ean': return 'ean';
    case 'allegro_product': return 'product_url';
    case 'allegro_offer':
    case 'allegro_aggregator':
      return 'allegro_url';
    default:
      return 'auto';
  }
}
