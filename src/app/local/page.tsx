'use client';

import { useState, useRef } from 'react';
import * as xlsx from 'xlsx';
import { UploadCloud, CheckCircle2, Loader2, Download, Search, AlertCircle } from 'lucide-react';
import { SingleOfferData } from '@/lib/allegro-scraper';

interface ResultItem {
  mainOffer: SingleOfferData;
  competitiveOffers: any[];
}

interface ScrapeError {
  url: string;
  error: string;
}

export default function LocalScraperPage() {
  const [file, setFile] = useState<File | null>(null);
  const [urls, setUrls] = useState<string[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [status, setStatus] = useState<'idle' | 'parsing' | 'scraping' | 'completed' | 'error'>('idle');
  const [results, setResults] = useState<ResultItem[]>([]);
  const [scrapeErrors, setScrapeErrors] = useState<ScrapeError[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    
    setFile(selectedFile);
    setStatus('parsing');
    setResults([]);
    setProgress({ current: 0, total: 0 });
    
    try {
      const data = await selectedFile.arrayBuffer();
      const wb = xlsx.read(data, { type: 'array' });
      const sheetName = wb.SheetNames.includes('All Offers (57)') ? 'All Offers (57)' : wb.SheetNames[0];
      const sheet = wb.Sheets[sheetName];
      const rows = xlsx.utils.sheet_to_json<any[]>(sheet, { header: 1 });
      
      const extractedUrls = Array.from(
        new Set(
          rows.flat().filter(cell => typeof cell === 'string' && cell.includes('allegro.pl'))
        )
      );
      
      if (extractedUrls.length === 0) {
        throw new Error('Nie znaleziono linków do Allegro. Upewnij się, że plik zawiera poprawne linki (allegro.pl).');
      }
      
      setUrls(extractedUrls);
      setProgress({ current: 0, total: extractedUrls.length });
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setErrorMsg(err.message || 'Błąd podczas odczytu pliku Excel.');
    }
  };

  const startScraping = async () => {
    if (urls.length === 0) return;
    
    setStatus('scraping');
    const newResults: ResultItem[] = [];
    const newErrors: ScrapeError[] = [];
    
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch('/api/local-scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urls[i] })
        });
        
        const json = await res.json();
        
        if (res.ok && json.success && json.data) {
          newResults.push(json.data);
          setResults([...newResults]);
        } else {
          const errMsg = json.error || `HTTP ${res.status}: ${res.statusText}`;
          console.error(`Błąd scrapowania dla ${urls[i]}:`, errMsg);
          newErrors.push({ url: urls[i], error: errMsg });
          setScrapeErrors([...newErrors]);
        }
      } catch (err: any) {
        const errMsg = err.message || 'Nieznany błąd sieci';
        console.error(`Błąd scrapowania dla ${urls[i]}:`, errMsg);
        newErrors.push({ url: urls[i], error: errMsg });
        setScrapeErrors([...newErrors]);
      }
      setProgress({ current: i + 1, total: urls.length });
    }
    
    setStatus('completed');
  };

  const downloadExcel = () => {
    if (results.length === 0) return;
    
    const flatData: any[] = [];
    results.forEach(item => {
      const main = item.mainOffer;
      flatData.push({
        Typ: 'Oferta Główna',
        Link: main.url,
        'Kategoria Główna': main.mainCategory,
        'Podkategoria': main.subCategory,
        'Liczba sztuk': main.stock,
        'Cena PL': main.price,
        'Tytuł': main.title,
        'Czas wysyłki': main.shipping_time,
        'Stan': main.condition,
        'Smart': main.smart ? 'Tak' : 'Nie',
        'Ilość ocen': main.reviews,
        'Średnia ocena': main.rating,
        'Sprzedanych 30 dni': main.sold_recent,
        'Cena z wysyłką': main.price_with_delivery,
        'Kiedy dostawa': main.delivery_date,
        'Warranty': main.warranty,
        'Czy jest supersprzedawca': main.super_seller ? 'Tak' : 'Nie',
        'Nazwa sprzedawcy': main.seller,
        'Czy jest oznaczenie supercena': main.super_price ? 'Tak' : 'Nie'
      });
      
      item.competitiveOffers?.forEach(comp => {
        flatData.push({
          Typ: 'Konkurencja',
          Link: comp.url,
          'Kategoria Główna': comp.mainCategory,
          'Podkategoria': comp.subCategory,
          'Liczba sztuk': comp.stock,
          'Cena PL': comp.price,
          'Tytuł': comp.title,
          'Czas wysyłki': comp.shipping_time,
          'Stan': comp.condition,
          'Smart': comp.smart ? 'Tak' : 'Nie',
          'Ilość ocen': comp.reviews,
          'Średnia ocena': comp.rating,
          'Sprzedanych 30 dni': comp.sold_recent,
          'Cena z wysyłką': comp.price_with_delivery,
          'Kiedy dostawa': comp.delivery_date,
          'Warranty': comp.warranty,
          'Czy jest supersprzedawca': comp.super_seller ? 'Tak' : 'Nie',
          'Nazwa sprzedawcy': comp.seller,
          'Czy jest oznaczenie supercena': comp.super_price ? 'Tak' : 'Nie'
        });
      });
    });

    const newWb = xlsx.utils.book_new();
    const ws = xlsx.utils.json_to_sheet(flatData);
    xlsx.utils.book_append_sheet(newWb, ws, 'Scraped Data');
    xlsx.writeFile(newWb, 'scraped_results_local.xlsx');
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500/30">
      <div className="absolute inset-0 bg-[url('/noise.png')] opacity-20 pointer-events-none mix-blend-overlay"></div>
      <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/20 blur-[120px] pointer-events-none"></div>

      <header className="relative z-10 border-b border-slate-800/60 bg-slate-900/50 backdrop-blur-xl sticky top-0">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Search className="w-4 h-4 text-white" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">Shoppalyzer <span className="text-slate-400 font-normal">Local</span></h1>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 py-12 flex-1 w-full flex flex-col gap-8">
        
        {/* Wstęp */}
        <div className="text-center space-y-4 max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Automatyzacja Scrapowania
          </h2>
          <p className="text-slate-400 text-lg leading-relaxed">
            Wgraj arkusz kalkulacyjny ze strukturą produktów. Wyciągniemy dla Ciebie aktualne ceny, stany magazynowe i oferty konkurencji.
          </p>
        </div>

        {/* Upload sekcja */}
        <div 
          className="group relative rounded-3xl border border-slate-800 bg-slate-900/40 backdrop-blur-xl p-8 hover:bg-slate-900/60 transition-all duration-500 flex flex-col items-center justify-center cursor-pointer overflow-hidden shadow-2xl shadow-black/50"
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-indigo-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
          
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload} 
            accept=".xlsx, .xls, .csv" 
            className="hidden" 
          />
          
          <div className="w-20 h-20 rounded-2xl bg-slate-800 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:bg-indigo-500/20 transition-all duration-500 ring-1 ring-slate-700 group-hover:ring-indigo-500/50 shadow-inner">
            <UploadCloud className="w-10 h-10 text-slate-400 group-hover:text-indigo-400 transition-colors duration-500" />
          </div>
          
          <h3 className="text-xl font-medium mb-2">{file ? file.name : 'Upuść plik Excel lub kliknij, aby wgrać'}</h3>
          <p className="text-slate-500 text-sm">Obsługiwane formaty: .xlsx, .xls. Wymagana kolumna z linkami ofert.</p>
          
          {urls.length > 0 && status === 'idle' && (
            <div className="mt-6 flex flex-col items-center animate-in fade-in slide-in-from-bottom-4 duration-700">
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500/10 text-emerald-400 text-sm font-medium border border-emerald-500/20">
                <CheckCircle2 className="w-4 h-4" /> 
                Pomyślnie odczytano {urls.length} linków
              </span>
              <button 
                onClick={(e) => { e.stopPropagation(); startScraping(); }}
                className="mt-6 relative overflow-hidden rounded-full bg-white text-slate-950 font-semibold px-8 py-3.5 hover:scale-105 transition-all duration-300 shadow-[0_0_40px_-10px_rgba(255,255,255,0.5)] active:scale-95"
              >
                Rozpocznij analizę
              </button>
            </div>
          )}

          {status === 'error' && (
            <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-red-500/10 text-red-400 text-sm font-medium border border-red-500/20">
              <AlertCircle className="w-4 h-4" /> 
              {errorMsg}
            </div>
          )}
        </div>

        {/* Sekcja postępu i wyników */}
        {(status === 'scraping' || status === 'completed') && (
          <div className="rounded-3xl border border-slate-800 bg-slate-900/40 backdrop-blur-xl p-8 animate-in fade-in slide-in-from-bottom-8 duration-700 shadow-xl">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h3 className="text-xl font-medium flex items-center gap-3">
                  {status === 'scraping' && <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />}
                  {status === 'completed' && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                  {status === 'scraping' ? 'Przetwarzanie ofert...' : 'Analiza zakończona'}
                </h3>
                <p className="text-slate-400 text-sm mt-1">
                  Ukończono {progress.current} z {progress.total} linków
                </p>
              </div>
              {status === 'completed' && results.length > 0 && (
                <button 
                  onClick={downloadExcel}
                  className="flex items-center gap-2 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-5 py-2.5 transition-all duration-300 shadow-[0_0_20px_-5px_rgba(79,70,229,0.5)] hover:shadow-[0_0_25px_-5px_rgba(79,70,229,0.7)]"
                >
                  <Download className="w-4 h-4" />
                  Eksportuj Excel
                </button>
              )}
            </div>

            {/* Pasek postępu */}
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden mb-8">
              <div 
                className="h-full bg-gradient-to-r from-indigo-500 to-blue-500 transition-all duration-500 ease-out"
                style={{ width: `${(progress.current / progress.total) * 100}%` }}
              ></div>
            </div>

            {/* Ostatnio pobrane */}
            <div className="space-y-4">
              {results.slice().reverse().slice(0, 5).map((res, i) => (
                <div key={i} className="rounded-2xl border border-slate-700/50 bg-slate-800/30 p-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <p className="text-sm font-medium text-slate-200 line-clamp-1">{res.mainOffer.title || 'Brak tytułu'}</p>
                    <span className="shrink-0 text-sm font-semibold bg-slate-950 px-2 py-1 rounded-md border border-slate-700 text-emerald-400">
                      {res.mainOffer.price ? `${res.mainOffer.price} PLN` : 'Brak ceny'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-slate-400">
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                      {res.mainOffer.seller}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                      Stan: {res.mainOffer.condition}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-rose-400"></span>
                      Konkurencja: {res.competitiveOffers?.length || 0} ofert
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Błędy scrapowania */}
            {scrapeErrors.length > 0 && (
              <div className="mt-6 space-y-3">
                <h4 className="text-sm font-medium text-red-400 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4" />
                  Błędy podczas scrapowania ({scrapeErrors.length})
                </h4>
                {scrapeErrors.map((err, i) => (
                  <div key={i} className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-sm">
                    <p className="text-red-300 font-medium truncate">{err.url}</p>
                    <p className="text-red-400/70 mt-1">{err.error}</p>
                  </div>
                ))}
              </div>
            )}
            
          </div>
        )}
      </main>
    </div>
  );
}
