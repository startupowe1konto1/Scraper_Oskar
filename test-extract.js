const fs = require('fs');
const cheerio = require('cheerio');

const html = fs.readFileSync('raw-offer.html', 'utf-8');
const $ = cheerio.load(html);

const result = {};

// Title
result.title = $('h1').text().trim();

// Price
const priceEl = $('div[aria-label*="aktualna cena"], div[aria-label*="cena"]').first();
if (priceEl.length) {
  const label = priceEl.attr('aria-label');
  const match = label.match(/(\d+),(\d{2})/);
  if (match) {
    result.price = parseFloat(`${match[1]}.${match[2]}`);
  }
}

// Condition
result.condition = $('div:contains("Stan")').next().text().trim() || $('li:contains("Stan")').text().replace('Stan', '').trim();

// Stock
const stockText = $('div:contains(" sztuk")').last().text() || $('div:contains("ostatnia sztuka")').text();
const stockMatch = stockText.match(/(\d+) sztuk/);
result.stock = stockMatch ? parseInt(stockMatch[1]) : (stockText.includes('ostatnia sztuka') ? 1 : null);

// Sold Recent
const soldText = $('div:contains("osoby kupiły")').last().text() || $('div:contains("osób kupiło")').last().text();
const soldMatch = soldText.match(/(\d+) osób|(\d+) osoby|(\d+) osoba/);
result.sold_recent = soldMatch ? parseInt(soldMatch[1] || soldMatch[2] || soldMatch[3]) : 0;

// Seller
// In raw-offer, seller name is often under "Sprzedaż i wysyłka" section.
const sellerDiv = $('div:contains("Sprzedaż i wysyłka")').parent().find('a[href*="/uzytkownik/"]');
result.seller = sellerDiv.first().text().trim();

// Smart
result.smart = html.includes('alt="Smart!"') || html.includes('Allegro Smart!');

// Delivery Time
const deliveryText = $('div:contains("dostawa")').last().text() || $('div:contains("Przewidywana dostawa")').next().text();
result.delivery = deliveryText.replace('Przewidywana dostawa', '').trim();

// Reviews
const reviewText = $('a[href*="#reviews"]').text() || $('div:contains("ocen i")').last().text();
const reviewMatch = reviewText.match(/(\d[\d\s]*)\s+ocen/);
result.reviews = reviewMatch ? parseInt(reviewMatch[1].replace(/\s/g, '')) : 0;

// Rating
const ratingText = $('span:contains("%")').first().text();
const ratingMatch = ratingText.match(/([\d,]+)%/);
result.rating = ratingMatch ? parseFloat(ratingMatch[1].replace(',', '.')) : null;

// Categories
result.categories = $('[data-role="breadcrumb-item"]').map((i, el) => $(el).text().trim()).get();
if (result.categories.length === 0) {
    result.categories = $('a[href*="/kategoria/"]').map((i, el) => $(el).text().trim()).get();
}

console.log(result);
