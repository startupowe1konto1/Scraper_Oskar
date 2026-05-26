import { describe, test, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// Mock auth — controls what user the route sees
vi.mock('@/lib/auth', () => ({
  currentUser: vi.fn(),
}));

// Mock store — prevents real DB writes
vi.mock('@/lib/store', () => ({
  insertQuery: vi.fn(),
  listQueriesForUser: vi.fn(),
}));

// Mock allegro parser — always returns a valid URL kind
vi.mock('@/lib/allegro', () => ({
  parseAllegroInput: vi.fn(() => ({
    kind: 'allegro_offer',
    raw: 'https://allegro.pl/oferta/test-123',
    normalized_url: 'https://allegro.pl/oferta/test-123',
    ean: undefined,
  })),
  inputTypeFromKind: vi.fn(() => 'allegro_url'),
}));

const { POST } = await import('@/app/api/v1/queries/route');
const { currentUser } = await import('@/lib/auth');
const { insertQuery } = await import('@/lib/store');

function makeRequest(body: object) {
  return new NextRequest('http://localhost/api/v1/queries', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/v1/queries — quota gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('returns 402 when monthly_queries_used >= monthly_queries_limit', async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      plan: 'free',
      created_at: '2026-01-01T00:00:00Z',
      monthly_queries_used: 1,
      monthly_queries_limit: 1,
    });

    const res = await POST(makeRequest({ input: 'https://allegro.pl/oferta/x', input_type: 'auto' }));

    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error.code).toBe('QUOTA_EXCEEDED');
    expect(insertQuery).not.toHaveBeenCalled();
  });

  test('returns 201 when monthly_queries_used < monthly_queries_limit', async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
      plan: 'pro',
      created_at: '2026-01-01T00:00:00Z',
      monthly_queries_used: 0,
      monthly_queries_limit: 100,
    });

    vi.mocked(insertQuery).mockResolvedValue({
      id: 'query-abc',
      user_id: 'user-1',
      status: 'queued',
      input: 'https://allegro.pl/oferta/x',
      input_type: 'allegro_url',
      created_at: '2026-05-17T00:00:00Z',
      resolved: {},
    } as never);

    const res = await POST(makeRequest({ input: 'https://allegro.pl/oferta/x', input_type: 'auto' }));

    expect(res.status).toBe(201);
    expect(insertQuery).toHaveBeenCalledOnce();
  });

  test('free user with 0 used and limit 1 can submit once', async () => {
    vi.mocked(currentUser).mockResolvedValue({
      id: 'user-2',
      email: 'free@test.com',
      plan: 'free',
      created_at: '2026-01-01T00:00:00Z',
      monthly_queries_used: 0,
      monthly_queries_limit: 1,
    });

    vi.mocked(insertQuery).mockResolvedValue({
      id: 'query-xyz',
      user_id: 'user-2',
      status: 'queued',
      input: 'https://allegro.pl/oferta/x',
      input_type: 'allegro_url',
      created_at: '2026-05-17T00:00:00Z',
      resolved: {},
    } as never);

    const res = await POST(makeRequest({ input: 'https://allegro.pl/oferta/x', input_type: 'auto' }));

    expect(res.status).toBe(201);
  });
});
