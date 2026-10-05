import { afterEach, describe, expect, it, vi } from 'vitest';

/** The route's own decisions: the status code, and that the answer is never cached. */

const checkHealth = vi.fn();
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@etai/core', () => ({ checkHealth: () => checkHealth() }));

const { GET } = await import('./route');
const call = () => GET(new Request('http://localhost/api/health'));

afterEach(() => checkHealth.mockReset());

describe('GET /api/health', () => {
  it.each([
    ['ok', 200],
    ['degraded', 200],
    ['down', 503],
  ] as const)('answers %s with %i', async (status, code) => {
    checkHealth.mockResolvedValue({ status, database: 'up', index: 'ready', checkedInMs: 3 });

    const response = await call();

    expect(response.status).toBe(code);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).status).toBe(status);
  });

  it('says nothing about what is indexed', async () => {
    checkHealth.mockResolvedValue({ status: 'ok', database: 'up', index: 'ready', checkedInMs: 3 });

    const body = await (await call()).json();

    expect(Object.keys(body).sort()).toEqual(['checkedInMs', 'database', 'index', 'status']);
  });
});
