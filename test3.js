const fs = require('fs');
const html = fs.readFileSync('raw-offer.html', 'utf-8');

const wMatch = html.match(/"name":"Stan",.*?"name":"Gwarancja","values":\["([^"]+)"\]/i) || html.match(/"name":"Gwarancja","values":\["([^"]+)"\]/i) || html.match(/Gwarancja[^<]+/i);
console.log('Warranty:', wMatch ? wMatch[1] || wMatch[0] : null);

const ssMatch = html.match(/"superSeller":\s*(true|false)/i) || html.match(/Super Sprzedawca/i);
console.log('SuperSeller:', ssMatch ? ssMatch[1] || !!ssMatch : false);

const dispatch = html.match(/"dispatchTime":\s*"([^"]+)"/i) || html.match(/wysyłka\s+(dzisiaj|w \d+\s*h|jutro)/i);
console.log('Dispatch:', dispatch ? dispatch[1] : null);

const deliveryMatch = html.match(/(?:Przewidywana dostawa|dostawa) (dzisiaj|jutro|pojutrze|w [^<]+|pon\.|wt\.|śr\.|czw\.|pt\.|sob\.|niedz\.)/i);
console.log('Delivery:', deliveryMatch ? deliveryMatch[0] : null);
