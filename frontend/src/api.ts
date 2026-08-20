export interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
}

// Always the same relative path in application code — in production this is Vercel's own
// serverless function (frontend/api/connection-details.ts), same origin. In local dev, Vite's
// dev server proxies this same path to the standalone token server (see vite.config.ts), so
// there's no environment-specific URL to configure here.
const CONNECTION_DETAILS_URL = '/api/connection-details';

export async function fetchConnectionDetails(): Promise<ConnectionDetails> {
  const response = await fetch(CONNECTION_DETAILS_URL, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Token server returned ${response.status}`);
  }
  return (await response.json()) as ConnectionDetails;
}
