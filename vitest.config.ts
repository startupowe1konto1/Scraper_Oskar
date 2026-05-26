import { defineConfig } from 'vitest/config';
import path from 'path';
import fs from 'fs';

// Manually load .env.local for tests (Next.js doesn't expose this to vitest automatically)
function loadEnvLocal(): Record<string, string> {
  const envPath = path.resolve(__dirname, '.env.local');
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const result: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    result[key] = value;
  }
  return result;
}

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    env: loadEnvLocal(),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
