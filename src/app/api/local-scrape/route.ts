import { NextResponse } from 'next/server';
import { scrapeAllegroPage, extractAggregatorUrl, extractSidebarCompetitorSummary, parseAllegroOffers, parseAllegroSingleOffer, SingleOfferData } from '@/lib/allegro-scraper';

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
    
    // 2. Extract sidebar summary (from "Ten produkt od innych sprzedających" panel)
    const sidebarSummary = extractSidebarCompetitorSummary(html);
    if (sidebarSummary) {
      console.log(`[local-scrape API] Panel boczny: znaleziono ${sidebarSummary.totalOffers ?? '?'} ofert konkurencji`);
    } else {
      console.log(`[local-scrape API] Panel boczny "Ten produkt od innych sprzedających" nie znaleziony — produkt może nie być w katalogu`);
    }
    
    // 3. Extract Aggregator URL (uses sidebar panel link, canonical URL, or productId)
    const aggUrl = extractAggregatorUrl(html);
    const competitiveOffers: SingleOfferData[] = [];
    
    if (aggUrl) {
      console.log(`[local-scrape API] URL agregatora ofert: ${aggUrl}`);
      const aggHtml = await scrapeAllegroPage(aggUrl);
      const allOffers = parseAllegroOffers(aggHtml);
      
      console.log(`[local-scrape API] Znaleziono ${allOffers.length} ofert na stronie agregatora`);
      
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
      console.log(`[local-scrape API] Przetwarzam ${deepOffersCount} najlepszych ofert konkurencji ze szczegółami (Głębokie Scrapowanie), a pozostałe ${Math.max(0, topOffers.length - 5)} płytko...`);
      
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
            price_with_delivery: comp.total_with_delivery,
            condition: mainOffer.condition, // Zazwyczaj stan ten sam
            stock: undefined,
            sold_recent: comp.sold_recent,
            seller: comp.seller,
            smart: comp.badges?.smart || false,
            delivery_date: 'Brak informacji (płytki skan)',
            shipping_time: 'Brak informacji (płytki skan)',
            warranty: 'Brak informacji (płytki skan)',
            super_seller: comp.badges?.super_seller || false,
            super_price: comp.badges?.super_price || false,
            reviews: comp.reviews,
            rating: comp.recommend_pct, // W parserze to było recommend_pct, frontend czyta rating
            mainCategory: mainOffer.mainCategory,
            subCategory: mainOffer.subCategory,
          });
        }
      }
    } else {
      console.log(`[local-scrape API] Brak linku do agregatora — ten produkt nie posiada katalogu ofert konkurencji`);
    }

    return NextResponse.json({
      success: true,
      data: {
        mainOffer,
        competitiveOffers,
        meta: {
          aggregatorUrl: aggUrl,
          totalCompetitorOffers: sidebarSummary?.totalOffers,
          deepScrapedCount: Math.min(competitiveOffers.length, 5),
          shallowScrapedCount: Math.max(0, competitiveOffers.length - 5),
        }
      }
    });

  } catch (error: any) {
    console.error(`[local-scrape API] Error:`, error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
