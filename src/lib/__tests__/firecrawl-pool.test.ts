import { describe, it, expect, beforeEach, vi } from 'vitest';
import { FirecrawlPool } from '../firecrawl-pool';

// Minimal Supabase-like client mock that tracks upserts
function mockSupabase(rows: Record<string, unknown>[] = []) {
  const state: Record<string, unknown>[] = [...rows];
  return {
    from: () => ({
      select: () => Promise.resolve({ data: state, error: null }),
      upsert: (r: Record<string, unknown>) => {
        const idx = state.findIndex(x => x.key_name === r.key_name);
        if (idx >= 0) state[idx] = { ...state[idx], ...r };
        else state.push(r);
        return Promise.resolve({ data: r, error: null });
      },
    }),
    _state: state,
  };
}

describe('FirecrawlPool', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('picks the key with the most remaining credits', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 800, monthly_limit: 1000, exhausted: false },
      { key_name: 'key-b', credits_used: 100, monthly_limit: 1000, exhausted: false },
      { key_name: 'key-c', credits_used: 500, monthly_limit: 1000, exhausted: false },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [
        { name: 'key-a', value: 'fc-aaa' },
        { name: 'key-b', value: 'fc-bbb' },
        { name: 'key-c', value: 'fc-ccc' },
      ],
    });
    await pool.loadUsage();
    const picked = pool.pickKey();
    expect(picked?.name).toBe('key-b');
  });

  it('skips exhausted keys', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 0, monthly_limit: 1000, exhausted: true },
      { key_name: 'key-b', credits_used: 0, monthly_limit: 1000, exhausted: false },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [
        { name: 'key-a', value: 'fc-aaa' },
        { name: 'key-b', value: 'fc-bbb' },
      ],
    });
    await pool.loadUsage();
    expect(pool.pickKey()?.name).toBe('key-b');
  });

  it('returns null when all keys are exhausted', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 0, monthly_limit: 1000, exhausted: true },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [{ name: 'key-a', value: 'fc-aaa' }],
    });
    await pool.loadUsage();
    expect(pool.pickKey()).toBeNull();
  });

  it('parses FIRECRAWL_API_KEYS env var', () => {
    const keys = FirecrawlPool.parseEnvKeys('fc-aaa,fc-bbb , fc-ccc');
    expect(keys).toEqual([
      { name: 'key-1', value: 'fc-aaa' },
      { name: 'key-2', value: 'fc-bbb' },
      { name: 'key-3', value: 'fc-ccc' },
    ]);
  });

  it('parses FIRECRAWL_API_KEYS with explicit names (key-name:fc-...)', () => {
    const keys = FirecrawlPool.parseEnvKeys('alpha:fc-aaa,beta:fc-bbb');
    expect(keys).toEqual([
      { name: 'alpha', value: 'fc-aaa' },
      { name: 'beta', value: 'fc-bbb' },
    ]);
  });

  it('marks a key exhausted after a 402 response', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 0, monthly_limit: 1000, exhausted: false },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [{ name: 'key-a', value: 'fc-aaa' }],
    });
    await pool.loadUsage();
    // Stub the HTTPS call to always return 402
    (vi.spyOn(pool as never, 'callFirecrawl') as unknown as { mockRejectedValue: (v: unknown) => void }).mockRejectedValue(
      Object.assign(new Error('Payment Required'), { status: 402 }),
    );
    await expect(pool.scrape({ url: 'https://example.com', formats: ['markdown'] })).rejects.toThrow();
    const rowAfter = db._state.find(r => r.key_name === 'key-a');
    expect(rowAfter?.exhausted).toBe(true);
  });

  it('rotates to the next key when the first returns 402 and succeeds with the second', async () => {
    const db = mockSupabase([
      { key_name: 'key-a', credits_used: 0, monthly_limit: 1000, exhausted: false },
      { key_name: 'key-b', credits_used: 0, monthly_limit: 1000, exhausted: false },
    ]);
    const pool = new FirecrawlPool({
      db: db as never,
      keys: [
        { name: 'key-a', value: 'fc-aaa' },
        { name: 'key-b', value: 'fc-bbb' },
      ],
    });
    await pool.loadUsage();

    // First call (key-a) throws 402, second call (key-b) succeeds.
    const callSpy = (vi.spyOn(pool as never, 'callFirecrawl') as unknown as {
      mockImplementation: (fn: (apiKey: string) => Promise<unknown>) => void;
    });
    callSpy.mockImplementation(async (apiKey: string) => {
      if (apiKey === 'fc-aaa') {
        throw Object.assign(new Error('Payment Required'), { status: 402 });
      }
      return { markdown: 'hello', metadata: { creditsUsed: 1 } };
    });

    const result = await pool.scrape({ url: 'https://example.com', formats: ['markdown'] });
    expect(result.markdown).toBe('hello');

    const keyA = db._state.find(r => r.key_name === 'key-a');
    const keyB = db._state.find(r => r.key_name === 'key-b');
    expect(keyA?.exhausted).toBe(true);
    expect(keyB?.exhausted).toBe(false);
    expect(keyB?.credits_used).toBe(1);
  });
});
