import { dedent, inference, initializeLogger, voice } from '@livekit/agents';
import dotenv from 'dotenv';
import { afterEach, beforeEach, describe, it } from 'vitest';
import { createAgent } from './agent.ts';
import { isLocalLlmReachable } from './testUtils/localLlm.ts';

dotenv.config({ path: '.env.local' });

initializeLogger({ pretty: true, level: 'warn' });

// These evaluations exercise real generation through LocalLLM (src/llm/localLlm.ts), so they
// need a real local LLM server running at LOCAL_LLM_URL. Skip with a clear message rather than
// failing confusingly when one isn't available — see src/testUtils/localLlm.ts.
const localLlmReachable = await isLocalLlmReachable();
if (!localLlmReachable) {
  console.warn(
    '[test] LOCAL_LLM_URL is not set or not reachable — skipping knowledge grounding tests. ' +
      'Start a local OpenAI-compatible LLM server and set LOCAL_LLM_URL in .env.local to run these.',
  );
}

describe.skipIf(!localLlmReachable)('agent knowledge grounding', () => {
  let session: voice.AgentSession;
  let judgeLlm: inference.LLM;

  beforeEach(async () => {
    judgeLlm = new inference.LLM({ model: 'openai/gpt-4.1-mini' });
    session = new voice.AgentSession();
    await session.start({ agent: createAgent() });
  });

  afterEach(async () => {
    await session?.close();
    await judgeLlm?.aclose();
  });

  /** The knowledge base has real Bugatti technical/press material, so this should be grounded. */
  it('grounds a Bugatti question in the knowledge base tool', { timeout: 30000 }, async () => {
    const result = await session.run({ userInput: 'Tell me about the Bugatti Chiron.' }).wait();

    result.expect.skipNextEventIf({ type: 'message', role: 'assistant' });
    result.expect.nextEvent().isFunctionCall({ name: 'search_bugatti_ferrari_data' });
    result.expect.nextEvent().isFunctionCallOutput();
    await result.expect
      .nextEvent()
      .isMessage({ role: 'assistant' })
      .judge(judgeLlm, {
        intent: dedent`
          Describes the Bugatti Chiron using information consistent with the knowledge base
          (e.g. it is a Bugatti hypercar/vehicle), without stating it has no information at all.
        `,
      });
  });

  /**
   * The provided Ferrari documents are investor financial reports, not vehicle spec sheets, so
   * the agent should say the top speed isn't available rather than inventing a number.
   */
  it(
    'declines to fabricate a Ferrari vehicle spec the knowledge base does not contain',
    { timeout: 30000 },
    async () => {
      const result = await session
        .run({ userInput: 'What is the top speed of the Ferrari SF90?' })
        .wait();

      result.expect.skipNextEventIf({ type: 'message', role: 'assistant' });
      result.expect.nextEvent().isFunctionCall({ name: 'search_bugatti_ferrari_data' });
      result.expect.nextEvent().isFunctionCallOutput();
      await result.expect
        .nextEvent()
        .isMessage({ role: 'assistant' })
        .judge(judgeLlm, {
          intent: dedent`
          Does not state a specific top speed figure for the Ferrari SF90. It should indicate
          that this information is not available in the current knowledge base, rather than
          guessing or stating a number.
        `,
        });
    },
  );
});
