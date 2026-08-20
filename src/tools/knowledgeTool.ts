import { dedent, tool } from '@livekit/agents';
import { z } from 'zod';
import { callTool } from '../knowledge/mcpClient.ts';
import type { KnowledgeSearchResult } from '../knowledge/search.ts';

/**
 * The only tool the agent has for grounding Bugatti/Ferrari answers. It
 * dispatches through `callTool` (src/knowledge/mcpClient.ts) rather than
 * calling `searchKnowledge` directly, so swapping in a real MCP server later
 * only requires changing that one file.
 */
export const searchBugattiFerrariData = tool({
  name: 'search_bugatti_ferrari_data',
  description: dedent`
    Search the local Bugatti/Ferrari knowledge base for information relevant to
    the user's question. Always call this before answering any question about
    Bugatti or Ferrari — never answer from memory. The knowledge base only
    contains what was actually indexed from the provided documents (a mix of
    Bugatti technical/press material and Ferrari financial reports), so it may
    not cover every topic (e.g. it may have no vehicle specs for some models).
    If the results don't contain the answer, say so plainly instead of guessing.
  `,
  parameters: z.object({
    query: z
      .string()
      .describe('The specific question or topic to search for, e.g. "Chiron top speed".'),
  }),
  execute: async ({ query }): Promise<{ found: boolean; results: KnowledgeSearchResult[] }> => {
    const results = (await callTool('search_knowledge', { query })) as KnowledgeSearchResult[];
    return { found: results.length > 0, results };
  },
});
