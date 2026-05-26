import { scrapeAllegroPage, extractAggregatorUrl, parseAllegroOffers, parseAllegroSingleOffer } from '../lib/allegro-scraper';
import * as fs from 'fs';
import * as xlsx from 'xlsx';

process.env.LOCAL_SCRAPE = 'true';

const EXCEL_INPUT = 'C:/Users/oskar/Desktop/Shoppalyzer/AirPods_Pro2_Data (1).xlsx';
const OUTPUT_JSON = 'scraped_results.json';
const OUTPUT_EXCEL = 'scraped_results.xlsx';

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log(`Wczytuję plik: ${EXCEL_INPUT}`);
  const wb = xlsx.readFile(EXCEL_INPUT);
  const sheetName = 'All Offers (57)'; // Or take first sheet if missing
  const sheet = wb.Sheets[sheetName] || wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<any>(sheet);

  const urls = rows.map(r => r.url || r.Url || r.URL || r['Link do oferty']).filter(Boolean);
  console.log(`Znaleziono ${urls.length} linków do zeskrapowania.`);

  const results = [];

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    console.log(`\n[${i + 1}/${urls.length}] Scraping: ${url}`);
    
    try {
      // 1. Opcjonalnie opóźnienie między żądaniami
      await delay(2000);
      
      const html = await scrapeAllegroPage(url);
      const mainOffer = parseAllegroSingleOffer(html, url);
      
      console.log(`> Tytuł: ${mainOffer.title}`);
      console.log(`> Sprzedawca: ${mainOffer.seller}, Cena: ${mainOffer.price} PLN`);
      
      const aggUrl = extractAggregatorUrl(html);
      let competitiveOffers = [];
      
      if (aggUrl) {
        console.log(`> Znaleziono agregator ofert: ${aggUrl}`);
        const aggHtml = await scrapeAllegroPage(aggUrl);
        competitiveOffers = parseAllegroOffers(aggHtml);
        console.log(`> Pobrano ${competitiveOffers.length} ofert konkurencji.`);
      } else {
        console.log(`> Brak linku do agregatora ofert dla tego produktu.`);
      }

      results.push({
        mainOffer,
        competitiveOffers
      });

    } catch (e: any) {
      console.error(`Błąd podczas scrapowania ${url}:`, e.message);
    }
  }

  console.log('\n=======================================');
  console.log('Zapisywanie wyników...');
  
  // Zapis do JSON
  fs.writeFileSync(OUTPUT_JSON, JSON.stringify(results, null, 2));
  console.log(`Zapisano do ${OUTPUT_JSON}`);

  // Zapis do pliku Excel
  // Dla Excela "spłaszczymy" dane: najpierw wiersz oferty głównej, a po nim wiersze konkurencji z odpowiednim znacznikiem.
  const flatData = [];
  
  for (const item of results) {
    const main = item.mainOffer;
    flatData.push({
      Typ: 'Oferta Główna',
      Link: main.url,
      'Kategoria Główna': main.mainCategory,
      'Podkategoria': main.subCategory,
      'Liczba sztuk': main.stock,
      'Cena PL': main.price,
      'Tytuł': main.title,
      'Czas wysyłki': main.delivery,
      'Stan': main.condition,
      'Smart': main.smart ? 'Tak' : 'Nie',
      'Ilość ocen': main.reviews,
      'Średnia ocena': main.rating,
      'Sprzedanych 30 dni': main.sold_recent,
      'Sprzedawca': main.seller
    });
    
    for (const comp of item.competitiveOffers) {
      flatData.push({
        Typ: 'Konkurencja',
        Link: comp.offer_url,
        'Kategoria Główna': main.mainCategory,
        'Podkategoria': main.subCategory,
        'Liczba sztuk': null, // Zazwyczaj brak na liście zbiorczej
        'Cena PL': comp.price,
        'Tytuł': comp.title,
        'Czas wysyłki': null, // Czasem brak precyzji w agregatorze
        'Stan': main.condition, // Zazwyczaj agregator dzieli po stanie, ale załóżmy ten z głównej
        'Smart': comp.badges?.smart ? 'Tak' : 'Nie',
        'Ilość ocen': comp.reviews,
        'Średnia ocena': comp.recommend_pct,
        'Sprzedanych 30 dni': comp.sold_recent,
        'Sprzedawca': comp.seller
      });
    }
  }

  const newWb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(flatData);
  xlsx.utils.book_append_sheet(newWb, ws, 'Scraped Data');
  xlsx.writeFile(newWb, OUTPUT_EXCEL);
  console.log(`Zapisano do ${OUTPUT_EXCEL}`);
}

main().catch(console.error);
