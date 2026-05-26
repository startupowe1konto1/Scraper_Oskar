import { NextResponse } from 'next/server';
import { scrapeAllegroPage, extractAggregatorUrl, parseAllegroOffers, parseAllegroSingleOffer, SingleOfferData } from '@/lib/allegro-scraper';

// Ustawienie flagi dla getPool, żeby pominęło bazę danych.
process.env.LOCAL_SCRAPE = 'true';

export async function POST(request: Request) {
  try {
    const { url } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    console.log(`[local-scrape API] Scraping: ${url}`);
    
    // 1. Fetch Main Offer HTML
    const html = await scrapeAllegroPage(url);
    const mainOffer = parseAllegroSingleOffer(html, url);
    
    // 2. Fetch Aggregator URL if exists
    const aggUrl = extractAggregatorUrl(html);
    const competitiveOffers: SingleOfferData[] = [];
    
    if (aggUrl) {
      console.log(`[local-scrape API] Znaleziono agregator ofert: ${aggUrl}`);
      const aggHtml = await scrapeAllegroPage(aggUrl);
      const allOffers = parseAllegroOffers(aggHtml);
      
      // Calculate average price
      const validPrices = allOffers.map(o => o.price).filter(p => p > 0);
      const avgPrice = validPrices.length > 0 ? validPrices.reduce((a, b) => a + b, 0) / validPrices.length : 0;
      
      // Filter out extreme outliers (e.g. price > 2 * avgPrice)
      let filteredOffers = allOffers;
      if (avgPrice > 0) {
        filteredOffers = allOffers.filter(o => o.price <= avgPrice * 2);
      }
      
      // Sort by sold_recent descending
      filteredOffers.sort((a, b) => (b.sold_recent || 0) - (a.sold_recent || 0));
      
      // No hard limit for total competitors, just use all filtered
      const topOffers = filteredOffers;
      
      // Top 5 gets deep scraping
      const deepOffersCount = Math.min(topOffers.length, 5);
      console.log(`[local-scrape API] Przetwarzam ${deepOffersCount} najlepszych ofert konkurencji ze szczegółami (Głębokie Scrapowanie), a pozostałe płytko...`);
      
      for (let i = 0; i < topOffers.length; i++) {
        const comp = topOffers[i];
        if (!comp.offer_url) continue;
        
        if (i < 5) {
          // Deep Scrape
          try {
            await new Promise(resolve => setTimeout(resolve, 500));
            const compHtml = await scrapeAllegroPage(comp.offer_url);
            const compData = parseAllegroSingleOffer(compHtml, comp.offer_url);
            competitiveOffers.push(compData);
          } catch (e: any) {
            console.warn(`[local-scrape API] Nie udało się pobrać oferty konkurencji głęboko ${comp.offer_url}:`, e.message);
          }
        } else {
          // Shallow Scrape (Mapped from Aggregator)
          competitiveOffers.push({
            url: comp.offer_url,
            title: comp.title,
            price: comp.price,
            price_with_delivery: undefined, // Wymaga głębokiego skanowania
            condition: mainOffer.condition, // Zazwyczaj stan ten sam
            stock: undefined,
            sold_recent: comp.sold_recent,
            seller: comp.seller,
            smart: comp.badges?.smart || false,
            delivery_date: 'Brak informacji (płytki skan)',
            shipping_time: 'Brak informacji (płytki skan)',
            warranty: 'Brak informacji (płytki skan)',
            super_seller: comp.badges?.super_seller || false,
            super_price: comp.badges?.super_price || false, // Można dodać sprawdzanie w parserze, ale załóżmy false
            reviews: comp.reviews,
            rating: comp.recommend_pct, // W parserze to było recommend_pct, frontend czyta rating
            mainCategory: mainOffer.mainCategory,
            subCategory: mainOffer.subCategory,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        mainOffer,
        competitiveOffers
      }
    });

  } catch (error: any) {
    console.error(`[local-scrape API] Error:`, error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
