import type { VercelRequest, VercelResponse } from '@vercel/node';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';

// Mirrors src/tokenServer.ts's AGENT_NAME (src/agentName.ts) — duplicated rather than imported
// across the frontend/repo-root boundary, since Vercel builds this function from within
// frontend/ alone. Keep this in sync if the agent's registered name ever changes there.
const AGENT_NAME = 'my-agent';

/**
 * Same-origin equivalent of src/tokenServer.ts, for when this frontend is deployed to Vercel:
 * the standalone Node token server only exists on whoever's machine runs `pnpm run token-server`,
 * which isn't reachable from a publicly deployed site. This function runs alongside the frontend
 * on Vercel instead, so any visitor can get a room token with no separate process required.
 *
 * Needs LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET set as Vercel Environment Variables
 * (Project Settings → Environment Variables) — the same values as the repo root's .env.local.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(404).json({ error: 'not found' });
    return;
  }

  const livekitUrl = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!livekitUrl || !apiKey || !apiSecret) {
    console.error(
      '[connection-details] LIVEKIT_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET is not set',
    );
    res.status(500).json({ error: 'server is missing LiveKit configuration' });
    return;
  }

  try {
    const roomName = `bugatti-ferrari-demo-${randomUUID().slice(0, 8)}`;
    const participantIdentity = `user-${randomUUID().slice(0, 8)}`;

    const accessToken = new AccessToken(apiKey, apiSecret, {
      identity: participantIdentity,
      ttl: '15m',
    });
    accessToken.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    // Same explicit dispatch src/tokenServer.ts sets up — without it the room connects fine but
    // the agent (registered under this name in src/main.ts) never joins it.
    accessToken.roomConfig = new RoomConfiguration({
      agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
    });
    const participantToken = await accessToken.toJwt();

    console.log(
      `[connection-details] minted token for room=${roomName} identity=${participantIdentity}`,
    );

    res.status(200).json({
      serverUrl: livekitUrl,
      roomName,
      participantToken,
      participantName: participantIdentity,
    });
  } catch (error) {
    console.error('[connection-details] failed to mint token:', error);
    res.status(500).json({ error: 'failed to mint token' });
  }
}
