/**
 * Debug: scrape the offer page, check if extractAggregatorUrl finds the comparison URL,
 * then scrape the comparison page and count parsed offers.
 */
import { scrapeAllegroPage, extractAggregatorUrl, parseAllegroOffers } from '@/lib/allegro-scraper';

const OFFER_URL = 'https://allegro.pl/oferta/apple-airpods-pro-usb-c-2-generacja-16893889737';

async function main() {
  console.log('=== Step 1: Scrape offer page ===');
  console.log(`URL: ${OFFER_URL}`);
  const offerHtml = await scrapeAllegroPage(OFFER_URL);
  console.log(`HTML length: ${offerHtml.length}`);

  // Check for 404
  const is404 = /<title>[^<]*404[^<]*<\/title>/i.test(offerHtml);
  console.log(`Is 404: ${is404}`);

  const aggregatorUrl = extractAggregatorUrl(offerHtml);
  console.log(`Aggregator URL: ${aggregatorUrl ?? 'NOT FOUND'}`);

  if (!aggregatorUrl) {
    console.log('\nNo aggregator URL found. Checking offer page structure:');
    const articleCount = (offerHtml.match(/<article/g) ?? []).length;
    console.log(`  <article> tags: ${articleCount}`);
    const offertyCount = (offerHtml.match(/oferty-produktu/g) ?? []).length;
    console.log(`  "oferty-produktu" mentions: ${offertyCount}`);
    // Show a snippet around "oferty-produktu" if it exists
    const idx = offerHtml.indexOf('oferty-produktu');
    if (idx >= 0) {
      console.log(`  Context: ...${offerHtml.substring(Math.max(0, idx-50), idx+150)}...`);
    }
    return;
  }

  console.log('\n=== Step 2: Scrape aggregator/comparison page ===');
  const aggHtml = await scrapeAllegroPage(aggregatorUrl);
  console.log(`HTML length: ${aggHtml.length}`);
  const articleCount = (aggHtml.match(/<article/g) ?? []).length;
  console.log(`<article> tags: ${articleCount}`);

  console.log('\n=== Step 3: Parse offers ===');
  const offers = parseAllegroOffers(aggHtml);
  console.log(`Parsed offers: ${offers.length}`);
  if (offers.length > 0) {
    console.log('First 3 offers:');
    offers.slice(0, 3).forEach((o, i) => {
      console.log(`  [${i+1}] ${o.seller} | ${o.price} PLN | ${o.recommend_pct}% | ${o.sold_recent} sold | smart=${o.badges.smart}`);
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
