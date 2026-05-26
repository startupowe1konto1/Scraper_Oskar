const fs = require('fs');
const html = fs.readFileSync('raw-offer.html', 'utf-8');

const priceMatch1 = html.match(/aria-label="(\d+),(\d{2})&nbsp;z[^"]*aktualna cena"/i);
const priceMatch2 = html.match(/<meta property="product:price:amount" content="([\d.]+)">/i);
console.log('priceMatch1:', priceMatch1 ? priceMatch1[0] : null);
console.log('priceMatch2:', priceMatch2 ? priceMatch2[0] : null);

const seller = html.match(/"seller":{"login":"([^"]+)"/i);
console.log('seller:', seller ? seller[1] : null);

const sellerDivRegex = html.match(/Sprzedaż i wysyłka[\s\S]{0,150}?>od<\/div>[\s\S]*?<span[^>]*>([^<]+)<\/span>/i);
console.log('sellerDivRegex:', sellerDivRegex ? sellerDivRegex[1] : null);
