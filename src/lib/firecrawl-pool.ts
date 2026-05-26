/**
 * Firecrawl API key pool — TypeScript port of shoppalyzer-tools/firecrawl-pool.js
 * adapted for production:
 *   - Keys come from the FIRECRAWL_API_KEYS env var (comma-separated)
 *   - Per-key credit usage is persisted in Supabase (firecrawl_key_usage table)
 *     so it survives Fly.io VM restarts.
 *
 * Usage in the worker:
 *   const pool = new FirecrawlPool({
 *     db: serviceClient,
 *     keys: FirecrawlPool.parseEnvKeys(process.env.FIRECRAWL_API_KEYS ?? ''),
 *   });
 *   await pool.loadUsage();
 *   const result = await pool.scrape({ url, formats: ['rawHtml'], proxy: 'stealth' });
 */
import https from 'https';
import type { SupabaseClient } from '@supabase/supabase-js';

const FIRECRAWL_API_HOST = 'api.firecrawl.dev';
const DEFAULT_MONTHLY_LIMIT = 1000;

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

interface KeyUsageRow {
  key_name: string;
  credits_used?: number;
  monthly_limit?: number;
  exhausted?: boolean;
  last_used_at?: string;
  exhausted_at?: string;
}

export interface ScrapeOptions {
  url: string;
  formats?: string[];
  proxy?: 'basic' | 'stealth' | 'auto';
  waitFor?: number;
  [k: string]: unknown;
}

export interface ScrapeResult {
  markdown?: string;
  html?: string;
  rawHtml?: string;
  metadata?: { creditsUsed?: number; [k: string]: unknown };
  [k: string]: unknown;
}

export class FirecrawlPool {
  private db: SupabaseClient | null;
  private keys: KeyState[];
  private loaded = false;

  constructor(args: { db?: SupabaseClient | null; keys: PoolKey[] }) {
    this.db = args.db ?? null;
    this.keys = args.keys.map(k => ({
      ...k,
      credits_used: 0,
      monthly_limit: DEFAULT_MONTHLY_LIMIT,
      exhausted: false,
    }));
  }

  /** Parse comma-separated env var into PoolKey[]. Supports "name:value" form. */
  static parseEnvKeys(raw: string): PoolKey[] {
    return raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map((entry, idx) => {
        if (entry.includes(':') && !entry.startsWith('fc-')) {
          const colonIdx = entry.indexOf(':');
          return { name: entry.slice(0, colonIdx).trim(), value: entry.slice(colonIdx + 1).trim() };
        }
        return { name: `key-${idx + 1}`, value: entry };
      });
  }

  /** Load persisted usage from Supabase. Call once at startup. */
  async loadUsage(): Promise<void> {
    if (!this.db) {
      this.loaded = true;
      return;
    }
    const { data, error } = await this.db.from('firecrawl_key_usage').select('*');
    if (error) throw new Error(`firecrawl_key_usage load failed: ${error.message}`);
    for (const row of (data ?? []) as KeyUsageRow[]) {
      const key = this.keys.find(k => k.name === row.key_name);
      if (!key) continue;
      key.credits_used = row.credits_used ?? 0;
      key.monthly_limit = row.monthly_limit ?? DEFAULT_MONTHLY_LIMIT;
      key.exhausted = row.exhausted ?? false;
      key.last_used_at = row.last_used_at;
      key.exhausted_at = row.exhausted_at;
    }
    this.loaded = true;
  }

  /** Pick the key with the most remaining credits. Returns null if all exhausted. */
  pickKey(): KeyState | null {
    const active = this.keys.filter(k => !k.exhausted);
    if (active.length === 0) return null;
    active.sort((a, b) => (b.monthly_limit - b.credits_used) - (a.monthly_limit - a.credits_used));
    return active[0];
  }

  /** Scrape with automatic key rotation on 402/429. */
  async scrape(options: ScrapeOptions): Promise<ScrapeResult> {
    if (!this.loaded) await this.loadUsage();

    const tried = new Set<string>();
    let lastErr: unknown;

    while (tried.size < this.keys.length) {
      const key = this.pickKey();
      if (!key || tried.has(key.name)) break;
      tried.add(key.name);

      try {
        const result = await this.callFirecrawl(key.value, options);
        const used = (result.metadata?.creditsUsed ?? 0) || this.estimateCredits(options);
        key.credits_used += used;
        key.last_used_at = new Date().toISOString();
        await this.persistKey(key);
        return result;
      } catch (err) {
        const e = err as Error & { status?: number };
        if (e.status === 402 || e.status === 429) {
          console.warn(
            `[firecrawl-pool] key '${key.name}' returned HTTP ${e.status} — marking exhausted, rotating to next key`,
          );
          key.exhausted = true;
          key.exhausted_at = new Date().toISOString();
          await this.persistKey(key);
          lastErr = err;
          continue;
        }
        throw err;
      }
    }

    throw (lastErr as Error) ?? new Error('All Firecrawl keys exhausted or failed');
  }

  private estimateCredits(opts: ScrapeOptions): number {
    return opts.proxy === 'stealth' ? 10 : 1;
  }

  private async persistKey(key: KeyState): Promise<void> {
    if (!this.db) return;
    const { error } = await this.db.from('firecrawl_key_usage').upsert(
      {
        key_name: key.name,
        credits_used: key.credits_used,
        monthly_limit: key.monthly_limit,
        exhausted: key.exhausted,
        last_used_at: key.last_used_at,
        exhausted_at: key.exhausted_at,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'key_name' },
    );
    if (error) console.warn(`[firecrawl-pool] persist failed for ${key.name}: ${error.message}`);
  }

  // exposed protected for tests to stub
  protected callFirecrawl(apiKey: string, options: ScrapeOptions): Promise<ScrapeResult> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(options);
      const req = https.request(
        {
          hostname: FIRECRAWL_API_HOST,
          path: '/v1/scrape',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'Content-Length': Buffer.byteLength(body),
          },
          timeout: 120_000,
        },
        res => {
          let data = '';
          res.on('data', chunk => (data += chunk));
          res.on('end', () => {
            if (res.statusCode === 402) {
              return reject(Object.assign(new Error('Payment Required'), { status: 402 }));
            }
            if (res.statusCode === 429) {
              return reject(Object.assign(new Error('Rate Limited'), { status: 429 }));
            }
            if ((res.statusCode ?? 500) >= 400) {
              return reject(
                Object.assign(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 300)}`), {
                  status: res.statusCode,
                }),
              );
            }
            try {
              const parsed = JSON.parse(data) as { success?: boolean; data?: ScrapeResult; error?: string };
              if (parsed.success === false) return reject(new Error(parsed.error ?? 'success=false'));
              resolve(parsed.data ?? (parsed as ScrapeResult));
            } catch (e) {
              reject(new Error(`Failed to parse response: ${(e as Error).message}`));
            }
          });
        },
      );
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Firecrawl request timeout (120s)'));
      });
      req.write(body);
      req.end();
    });
  }
}
