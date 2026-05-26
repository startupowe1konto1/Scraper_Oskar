const fs = require('fs');

const html = fs.readFileSync('raw-offer.html', 'utf-8');

function extract(html) {
  const result = {};

  // Title
  const titleMatch = html.match(/<title>([^<]+?) - Allegro\.pl<\/title>/i);
  result.title = titleMatch ? titleMatch[1].trim() : '';

  // Price
  const priceMatch = html.match(/<meta property="product:price:amount" content="([^"]+)">/i) || html.match(/aria-label="(\d+),(\d{2})&nbsp;z[^"]*aktualna cena"/i);
  result.price = priceMatch ? (priceMatch[2] ? parseFloat(`${priceMatch[1]}.${priceMatch[2]}`) : parseFloat(priceMatch[1])) : null;

  // Condition
  const conditionMatch = html.match(/Stan[\s\S]{0,50}?<div[^>]*>([^<]+)<\/div>/i) || html.match(/>Stan<[\s\S]*?>([^<]+)</i);
  result.condition = conditionMatch ? conditionMatch[1].trim() : '';

  // Stock
  const stockMatch = html.match(/z (\d+) sztuk/i) || html.match(/Dostępn[ae] (\d+) sztuk/i) || html.match(/ostatnia sztuka/i);
  result.stock = stockMatch ? (stockMatch[1] ? parseInt(stockMatch[1]) : 1) : null;

  // Sold Recent
  const soldMatch = html.match(/(\d+)\s+osob[ay]?\s+kupi[łl][yo]\s+tę ofertę/i) || html.match(/(\d+)\s+osob[ay]?\s+kupi[łl][yo]/i);
  result.sold_recent = soldMatch ? parseInt(soldMatch[1]) : 0;

  // Seller
  const sellerMatch = html.match(/"login":"([^"]+)"/i) || html.match(/Sprzedaż i wysyłka[\s\S]{0,100}?od[\s\S]{0,50}?Użytkownik\s+([^<]+)/i) || html.match(/<div[^>]*>Sprzedaż i wysyłka<\/div>[\s\S]*?<a href="\/uzytkownik\/[^"]+"[^>]*>([^<]+)<\/a>/i);
  result.seller = sellerMatch ? sellerMatch[1].replace(/<[^>]+>/g, '').trim() : '';

  // Smart
  result.smart = /alt="Smart!"|Allegro Smart!/i.test(html);

  // Delivery Time
  const deliveryMatch = html.match(/(?:Przewidywana dostawa|dostawa) (dzisiaj|jutro|pojutrze|w [^<]+|pon\.|wt\.|śr\.|czw\.|pt\.|sob\.|niedz\.)/i);
  result.delivery = deliveryMatch ? deliveryMatch[0] : '';

  // Reviews
  const reviewMatch = html.match(/(\d[\d\s]*)\s+ocen(?:y|i)?\b/i);
  result.reviews = reviewMatch ? parseInt(reviewMatch[1].replace(/\s/g, '')) : 0;

  // Rating
  const ratingMatch = html.match(/Średnia ocen ([\d,]+) na 5/i) || html.match(/Poleca\s*([\d,]+)%/i);
  result.rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;

  // Categories
  const catMatches = [...html.matchAll(/data-role="breadcrumb-item"[^>]*>([^<]+)<\/a>/gi)];
  const cats = catMatches.map(m => m[1].trim());
  result.mainCategory = cats.length > 1 ? cats[1] : '';
  result.subCategory = cats.length > 2 ? cats[2] : '';

  return result;
}

console.log(extract(html));
