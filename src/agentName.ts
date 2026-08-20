/**
 * Shared between src/main.ts (worker registration) and src/tokenServer.ts (room dispatch
 * config) so they can't drift apart. Our agent worker registers with this explicit name
 * (see ServerOptions in main.ts), which means LiveKit requires an explicit dispatch to send
 * it into a room — the token server sets that up via RoomAgentDispatch.
 */
export const AGENT_NAME = 'my-agent';
