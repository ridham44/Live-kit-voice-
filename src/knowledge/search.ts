import { getKnowledgeChunks } from './loadDocuments.ts';
import type { KnowledgeChunk } from './loadDocuments.ts';

export interface KnowledgeSearchResult {
  text: string;
  source: string;
  score: number;
}

const STOPWORDS = new Set([
  'the',
  'a',
  'an',
  'is',
  'are',
  'was',
  'were',
  'of',
  'and',
  'or',
  'to',
  'in',
  'on',
  'for',
  'with',
  'what',
  'which',
  'how',
  'do',
  'does',
  'did',
  'tell',
  'me',
  'about',
  'it',
  'its',
  'than',
  'vs',
  'versus',
  'compare',
  'between',
  'this',
  'that',
  'these',
  'those',
  'you',
  'your',
]);

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

/**
 * Simple in-memory keyword-overlap search over pre-extracted chunks. No vector
 * database — the corpus is small enough that scoring every chunk on every
 * query is instant, and this keeps the retrieval step easy to reason about.
 */
export function searchChunks(
  chunks: KnowledgeChunk[],
  query: string,
  topK = 5,
): KnowledgeSearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || chunks.length === 0) {
    return [];
  }

  const scored = chunks
    .map((chunk) => {
      const chunkTokens = new Set(tokenize(chunk.text));
      let score = 0;
      for (const token of queryTokens) {
        if (chunkTokens.has(token)) {
          score += 1;
        }
      }
      return { text: chunk.text, source: chunk.source, score };
    })
    .filter((result) => result.score > 0);

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/** Searches the real PDF-derived knowledge base loaded from `Documents/`. */
export async function searchKnowledge(query: string, topK = 5): Promise<KnowledgeSearchResult[]> {
  const chunks = await getKnowledgeChunks();
  return searchChunks(chunks, query, topK);
}
