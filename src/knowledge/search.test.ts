import { describe, expect, it } from 'vitest';
import type { KnowledgeChunk } from './loadDocuments.ts';
import { searchChunks } from './search.ts';

const CHUNKS: KnowledgeChunk[] = [
  {
    id: 'chiron#0',
    source: 'chiron.pdf',
    text: 'The Bugatti Chiron has a top speed of 261 miles per hour and a W16 quad-turbo engine.',
  },
  {
    id: 'centodieci#0',
    source: 'centodieci.pdf',
    text: 'The Bugatti Centodieci is a limited-run hypercar inspired by the EB110.',
  },
  {
    id: 'ferrari-financial#0',
    source: 'ferrari-q1-2026.pdf',
    text: 'Ferrari reported first quarter 2026 revenue growth driven by higher shipment volumes.',
  },
];

describe('searchChunks', () => {
  it('ranks chunks containing the query terms above unrelated chunks', () => {
    const results = searchChunks(CHUNKS, 'What is the top speed of the Chiron?');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.source).toBe('chiron.pdf');
  });

  it('returns results tagged with their source document', () => {
    const results = searchChunks(CHUNKS, 'Centodieci hypercar');

    expect(results[0]?.source).toBe('centodieci.pdf');
  });

  it('ranks a financial-report chunk below a matching vehicle-spec chunk', () => {
    const results = searchChunks(CHUNKS, 'Ferrari top speed');

    // The financial chunk only matches on the word "Ferrari"; a chunk that actually
    // discusses top speed should still outrank it.
    expect(results[0]?.source).not.toBe('ferrari-q1-2026.pdf');
  });

  it('returns an empty array when nothing matches, so the caller can say "not available"', () => {
    const results = searchChunks(CHUNKS, 'quantum computing roadmap');

    expect(results).toEqual([]);
  });

  it('returns an empty array for an empty corpus', () => {
    const results = searchChunks([], 'Chiron top speed');

    expect(results).toEqual([]);
  });
});
