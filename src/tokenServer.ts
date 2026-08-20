import dotenv from 'dotenv';
import { AccessToken, RoomAgentDispatch, RoomConfiguration } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AGENT_NAME } from './agentName.ts';

// Load environment variables from a local file, same as src/main.ts.
dotenv.config({ path: '.env.local' });

const PORT = Number(process.env.TOKEN_SERVER_PORT ?? 8080);
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
  throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set in .env.local');
}

/**
 * Minimal token-minting server for the demo frontend. This is the only place
 * that touches the LiveKit API secret — the frontend never sees it, only the
 * short-lived room token this endpoint returns.
 */
const server = createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/connection-details') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
    return;
  }

  void (async () => {
    try {
      const roomName = `bugatti-ferrari-demo-${randomUUID().slice(0, 8)}`;
      const participantIdentity = `user-${randomUUID().slice(0, 8)}`;

      const accessToken = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
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
      // Our worker registers with an explicit agentName (see ServerOptions in main.ts), which
      // means it is NOT auto-dispatched to every room — without this, the room connects fine
      // but the agent never joins it, so nothing downstream (STT/LLM) ever runs.
      accessToken.roomConfig = new RoomConfiguration({
        agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
      });
      const participantToken = await accessToken.toJwt();

      console.log(
        `[token-server] minted token for room=${roomName} identity=${participantIdentity}`,
      );

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          serverUrl: LIVEKIT_URL,
          roomName,
          participantToken,
          participantName: participantIdentity,
        }),
      );
    } catch (error) {
      console.error('[token-server] failed to mint token:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'failed to mint token' }));
    }
  })();
});

server.listen(PORT, () => {
  console.log(`[token-server] listening on http://localhost:${PORT}`);
});
