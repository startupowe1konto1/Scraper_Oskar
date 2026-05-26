// src/lib/__tests__/auth.test.ts
import { describe, test, expect } from 'vitest';
import { currentUser } from '../auth';

describe('currentUser', () => {
  test('throws UNAUTHENTICATED when no Authorization header', async () => {
    const req = new Request('http://localhost/api/v1/me');
    await expect(currentUser(req)).rejects.toThrow('UNAUTHENTICATED');
  });

  test('throws UNAUTHENTICATED when token is malformed', async () => {
    const req = new Request('http://localhost/api/v1/me', {
      headers: { Authorization: 'Bearer not-a-real-jwt' },
    });
    await expect(currentUser(req)).rejects.toThrow();
  });
});
