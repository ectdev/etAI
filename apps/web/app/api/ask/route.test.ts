import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The answer route when the conversation cannot be stored.
 *
 * Everything around the route is replaced: the session, the model, the analytics record
 * and the conversation store. What is under test is only the route's own decision, that a
 * storage failure is reported beside an answer that exists rather than instead of it.
 */

const recordTurn = vi.fn();
const recordQuestion = vi.fn();

vi.mock('@/lib/session', () => ({
  requireRole: async () => ({ user: { id: 'user-1', role: 'user', email: 'u@etai.local' } }),
}));
vi.mock('@/lib/conversations', () => ({ recordTurn: (...args: unknown[]) => recordTurn(...args) }));
vi.mock('@etai/core/analytics', () => ({
  recordQuestion: (...args: unknown[]) => recordQuestion(...args),
}));
vi.mock('@etai/core', () => ({
  answerQuestion: async () => ({
    answer: 'Every release passes four checks [1].',
    coverage: 'full',
    gap: null,
    citations: [],
    sources: [],
    droppedCitations: [],
    coherence: [],
    timings: { retrievalMs: 12, generationMs: 900 },
    model: 'test-model',
  }),
}));

const { POST } = await import('./route');

const ask = (body: object) =>
  POST(
    new Request('http://localhost/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  recordQuestion.mockResolvedValue(undefined);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  recordTurn.mockReset();
  recordQuestion.mockReset();
});

describe('POST /api/ask', () => {
  it('returns the conversation it was stored in when storing works', async () => {
    recordTurn.mockResolvedValue('conversation-1');

    const response = await ask({ question: 'Which checks must a release pass?' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.conversationId).toBe('conversation-1');
    expect(body.saved).toBeUndefined();
  });

  it('still returns the answer when it cannot be stored, and says it was not saved', async () => {
    recordTurn.mockRejectedValue(Object.assign(new Error('connection lost'), { code: '08006' }));

    const response = await ask({
      question: 'Which checks must a release pass?',
      conversationId: '11111111-2222-4333-8444-555555555555',
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.answer).toBe('Every release passes four checks [1].');
    expect(body.saved).toBe(false);
    // Kept, so the next question still goes to the conversation the browser is in.
    expect(body.conversationId).toBe('11111111-2222-4333-8444-555555555555');
    expect(console.error).toHaveBeenCalled();
  });

  it('does the same for a greeting, which is stored like any other turn', async () => {
    recordTurn.mockRejectedValue(new Error('connection lost'));

    const response = await ask({ question: 'hello' });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.saved).toBe(false);
    expect(body.conversationId).toBeNull();
  });

  it('records the question and stores the turn at the same time, not one after the other', async () => {
    let analyticsDone = 0;
    let turnStarted = 0;
    recordQuestion.mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(() => {
            analyticsDone = performance.now();
            resolve(undefined);
          }, 100),
        ),
    );
    recordTurn.mockImplementation(async () => {
      turnStarted = performance.now();
      return 'conversation-1';
    });

    await ask({ question: 'Which checks must a release pass?' });

    expect(turnStarted).toBeGreaterThan(0);
    expect(turnStarted).toBeLessThan(analyticsDone);
  });
});
