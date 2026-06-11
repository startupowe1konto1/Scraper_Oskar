import { ScrapeGraphAI } from 'scrapegraph-js';

const DEFAULT_MONTHLY_LIMIT = 10000;

export interface PoolKey {
  name: string;
  value: string;
}

interface KeyState extends PoolKey {
  credits_used: number;
  monthly_limit: number;
  exhausted: boolean;
  last_used_at?: string;
  exhausted_at?: string;
}

export interface ScrapeOptions {
  url: string;
  proxy?: 'basic' | 'advanced' | 'stealth';
  waitFor?: number;
  [k: string]: unknown;
}

export interface ScrapeResult {
  html?: string;
  metadata?: { creditsUsed?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export class ScrapeGraphPool {
  private keys: KeyState[];
  private loaded = false;

  constructor(args: { keys: PoolKey[] }) {
    this.keys = args.keys.map(k => ({
      ...k,
      credits_used: 0,
      monthly_limit: DEFAULT_MONTHLY_LIMIT,
      exhausted: false,
    }));
  }

  static parseEnvKeys(raw: string): PoolKey[] {
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map((entry, idx) => {
        if (entry.includes(':') && !entry.startsWith('sg-')) {
          const colonIdx = entry.indexOf(':');
          return { name: entry.slice(0, colonIdx).trim(), value: entry.slice(colonIdx + 1).trim() };
        }
        return { name: `key-${idx + 1}`, value: entry };
      });
  }

  async loadUsage(): Promise<void> {
    this.loaded = true;
  }

  pickKey(): KeyState | null {
    const active = this.keys.filter(k => !k.exhausted);
    if (active.length === 0) return null;
    active.sort((a, b) => (b.monthly_limit - b.credits_used) - (a.monthly_limit - a.credits_used));
    return active[0];
  }

  async scrape(options: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.loaded) await this.loadUsage();

    const tried = new Set<string>();
    let lastErr: unknown;

    while (tried.size < this.keys.length) {
      const key = this.pickKey();
      if (!key || tried.has(key.name)) break;
      tried.add(key.name);

      try {
        const result = await this.callScrapeGraph(key.value, options);
        // Estimate 1 credit if not provided by SDK
        const used = result.metadata?.creditsUsed ?? 1;
        key.credits_used += used;
        key.last_used_at = new Date().toISOString();
        return result;
      } catch (err) {
        const e = err as Error & { status?: number };
        // ScrapeGraphAI uses 402/429 for limits or 401 for bad key
        if (e.status === 402 || e.status === 429 || e.status === 401 || e.message?.includes('402') || e.message?.includes('429')) {
          console.warn(
            `[scrapegraph-pool] key '${key.name}' returned HTTP ${e.status || e.message} — marking exhausted, rotating to next key`,
          );
          key.exhausted = true;
          key.exhausted_at = new Date().toISOString();
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    throw (lastErr as Error) ?? new Error('All ScrapeGraphAI keys exhausted or failed');
  }

  protected async callScrapeGraph(apiKey: string, options: ScrapeOptions): Promise<ScrapeResult> {
    const sgai = ScrapeGraphAI({ apiKey });
    
    // Determine proxy logic if needed
    // ScrapeGraphAI SDK uses smart AI scraping. To just extract HTML without AI overhead:
    const result = await sgai.scrape({
      url: options.url,
      // @ts-ignore
      formats: [{ type: 'html', mode: 'normal' }]
    });
    
    if (result.status === 'success') {
       const htmlResult = (result.data as any)?.results?.html;
       let htmlStr = '';
       if (Array.isArray(htmlResult)) {
         htmlStr = htmlResult.join('\\n');
       } else if (htmlResult?.data) {
         htmlStr = Array.isArray(htmlResult.data) ? htmlResult.data.join('\\n') : htmlResult.data;
       } else {
         htmlStr = String(htmlResult || '');
       }

       return {
         html: htmlStr,
         metadata: {
           creditsUsed: 1
         }
       } as ScrapeResult;
    }
    
    throw Object.assign(new Error(`ScrapeGraphAI Error: ${JSON.stringify(result)}`), { status: 500 });
  }
}
