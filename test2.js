const fs = require('fs');
const html = fs.readFileSync('raw-offer.html', 'utf-8');

const d = html.match(/"deliveryCost":"([^"]+)"/i);
console.log('DeliveryCost:', d ? d[1] : null);

const w = html.match(/"name":"Gwarancja","values":\["([^"]+)"\]/i);
console.log('Warranty:', w ? w[1] : null);

const ss = html.match(/Super\s*Sprzedawca/i);
console.log('SuperSeller:', !!ss);

const sc = html.match(/Supercena/i);
console.log('SuperCena:', !!sc);

// "Wysyłka natychmiast" or similar
const wys = html.match(/wysyłka\s+[^<"]+/i);
console.log('Wysyłka:', wys ? wys[0] : null);

// "Dostawa pojutrze"
const dos = html.match(/dostawa\s+[^<"]+/i);
console.log('Dostawa:', dos ? dos[0] : null);
