/**
 * One-time seed of firecrawl_key_usage from the local laptop pool JSON file.
 * Run once during deployment, then never again.
 *
 *   npx tsx --env-file .env.local scripts/seed-firecrawl-usage.ts
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { createServiceClient } from '../src/lib/db';

const LOCAL_FILE = path.join(os.homedir(), '.shoppalyzer', 'firecrawl-keys.json');

interface LocalKey {
  name: string;
  credits_used?: number;
  monthly_limit?: number;
  exhausted?: boolean;
  last_used_at?: string;
  exhausted_at?: string;
}

async function main() {
  if (!fs.existsSync(LOCAL_FILE)) {
    console.error(`Local pool file not found at ${LOCAL_FILE}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(LOCAL_FILE, 'utf8')) as { keys: LocalKey[] };
  const db = createServiceClient();

  for (const k of data.keys) {
    const row = {
      key_name: k.name,
      credits_used: k.credits_used ?? 0,
      monthly_limit: k.monthly_limit ?? 1000,
      exhausted: k.exhausted ?? false,
      last_used_at: k.last_used_at ?? null,
      exhausted_at: k.exhausted_at ?? null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await db.from('firecrawl_key_usage').upsert(row, { onConflict: 'key_name' });
    if (error) {
      console.error(`✗ ${k.name}: ${error.message}`);
    } else {
      console.log(`✓ ${k.name}: ${row.credits_used} used / ${row.monthly_limit}`);
    }
  }
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
