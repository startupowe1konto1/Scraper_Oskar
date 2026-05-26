const fs = require('fs');
const cheerio = require('cheerio');

function parseAllegroSingleOffer(html, url) {
  const $ = cheerio.load(html);
  const result = { url };
  
  result.title = $('h1').first().text().trim() || $('title').text().replace(' - Allegro.pl', '').trim();
  
  // Price
  const priceMatch = html.match(/aria-label="(\d+),(\d{2})&nbsp;z[^"]*aktualna cena"/i) || html.match(/<meta property="product:price:amount" content="([\d.]+)">/i);
  if (priceMatch && priceMatch[2]) {
      result.price = parseFloat(`${priceMatch[1]}.${priceMatch[2]}`);
  } else if (priceMatch && priceMatch[1]) {
      result.price = parseFloat(priceMatch[1]);
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
  const sellerDiv = $('div:contains("Sprzedaż i wysyłka")').parent().find('a[href*="/uzytkownik/"]').first();
  const sellerText = sellerDiv.text().trim();
  const sellerRegex = html.match(/Sprzedaż i wysyłka[\s\S]{0,100}?Użytkownik\s+([^<]+)/i) || html.match(/"seller":{"login":"([^"]+)"/i);
  result.seller = sellerText || (sellerRegex ? sellerRegex[1] : 'unknown');
  
  result.smart = /alt="Smart!"|Allegro Smart!/i.test(html);
  
  const deliveryMatch = html.match(/(?:Przewidywana dostawa|dostawa) (dzisiaj|jutro|pojutrze|w [^<]+|pon\.|wt\.|śr\.|czw\.|pt\.|sob\.|niedz\.)/i);
  result.delivery = deliveryMatch ? deliveryMatch[0] : '';
  
  const reviewMatch = html.match(/(\d[\d\s]*)\s+ocen(?:y|i)?\b/i);
  result.reviews = reviewMatch ? parseInt(reviewMatch[1].replace(/\s/g, '')) : 0;
  
  const ratingMatch = html.match(/Średnia ocen ([\d,]+) na 5/i) || html.match(/Poleca\s*([\d,]+)%/i);
  result.rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;
  
  const cats = $('[data-role="breadcrumb-item"]').map((i, el) => $(el).text().trim()).get();
  result.mainCategory = cats.length > 1 ? cats[1] : '';
  result.subCategory = cats.length > 2 ? cats[2] : '';

  return result;
}

const html = fs.readFileSync('raw-offer.html', 'utf-8');
console.log(parseAllegroSingleOffer(html, 'http://test'));
