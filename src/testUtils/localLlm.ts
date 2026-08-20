/**
 * Checks whether an OpenAI-compatible server is actually reachable at
 * LOCAL_LLM_URL. Agent eval tests need this because `createAgent()` now uses
 * `LocalLLM` (src/llm/localLlm.ts) instead of LiveKit's hosted inference —
 * tests that exercise real generation need a real local LLM running.
 */
export async function isLocalLlmReachable(timeoutMs = 2000): Promise<boolean> {
  const baseURL = process.env.LOCAL_LLM_URL;
  if (!baseURL) {
    return false;
  }
  try {
    const response = await fetch(`${baseURL.replace(/\/$/, '')}/models`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    return response.ok;
  } catch {
    return false;
  }
}
