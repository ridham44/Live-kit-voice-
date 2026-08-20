export interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
}

// In local dev, VITE_TOKEN_SERVER_URL points at the standalone server (src/tokenServer.ts,
// `pnpm run token-server`). Left unset, this falls back to the same-origin serverless function
// at frontend/api/connection-details.ts — the one Vercel deploys alongside this frontend, so a
// publicly deployed site never depends on someone's local token server being reachable.
const TOKEN_SERVER_URL = import.meta.env.VITE_TOKEN_SERVER_URL;
const CONNECTION_DETAILS_URL = TOKEN_SERVER_URL
  ? `${TOKEN_SERVER_URL}/connection-details`
  : '/api/connection-details';

export async function fetchConnectionDetails(): Promise<ConnectionDetails> {
  const response = await fetch(CONNECTION_DETAILS_URL, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Token server returned ${response.status}`);
  }
  return (await response.json()) as ConnectionDetails;
}
