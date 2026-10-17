import { describe, expect, it } from 'vitest';
import { addUsage, emptyUsage, usageOf, withUsage, recordUsage } from './usage';

describe('AI cost estimate', () => {
  it('prices tokens, cache and web search at Opus 5.5 list prices', () => {
    // 1M in ($4) + 0.1M out ($2) + 0.2M cache write ($1) + 1M cache read ($0.20) + 3 searches ($0.03)
    const u = usageOf('claude-opus-5-5', {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_creation_input_tokens: 200_000,
      cache_read_input_tokens: 1_000_000,
      server_tool_use: { web_search_requests: 3 },
    });
    expect(u.usd).toBeCloseTo(4 + 2 + 1 + 0.2 + 0.03, 6);
  });
  it('doubles token prices in fast mode and knows fallback models', () => {
    expect(usageOf('claude-opus-5-5', { input_tokens: 1_000_000, output_tokens: 0, speed: 'fast' }).usd).toBeCloseTo(8);
    expect(usageOf('claude-opus-5', { input_tokens: 1_000_000, output_tokens: 0 }).usd).toBeCloseTo(5);
  });
  it('sums every call made while handling one request', async () => {
    const { usage } = await withUsage(async () => {
      recordUsage('claude-opus-5-5', { input_tokens: 1000, output_tokens: 500 });
      await Promise.resolve();
      recordUsage('claude-opus-5-5', { input_tokens: 2000, output_tokens: 100 });
    });
    expect(usage.calls).toBe(2);
    expect(usage.input).toBe(3000);
    expect(addUsage(emptyUsage(), usage).usd).toBeCloseTo((3000 * 4 + 600 * 20) / 1e6);
  });
});
