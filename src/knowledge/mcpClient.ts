import { statusBus } from '../status/statusBus.ts';
import { searchKnowledge } from './search.ts';

export type ToolCallArgs = Record<string, unknown>;

/**
 * Stand-in for a real MCP client. Everything above this function (the
 * `searchBugattiFerrariData` tool in `src/tools/knowledgeTool.ts`) only ever
 * calls `callTool(name, args)` — swap the body below for a real MCP
 * transport (stdio/SSE) once your company's MCP server is available, and
 * nothing else in the agent needs to change.
 */
export async function callTool(name: string, args: ToolCallArgs): Promise<unknown> {
  switch (name) {
    case 'search_knowledge': {
      const query = typeof args.query === 'string' ? args.query : '';
      console.log(`[knowledge] search_knowledge query="${query}"`);
      try {
        const results = await searchKnowledge(query);
        console.log(
          `[knowledge] search_knowledge matched ${results.length} chunk(s): ${results
            .map((r) => r.source)
            .join(', ')}`,
        );
        statusBus.publish({ stage: 'knowledge', status: 'ok' });
        return results;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[knowledge] search_knowledge failed:`, error);
        statusBus.publish({ stage: 'knowledge', status: 'error', detail: message });
        throw error;
      }
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
