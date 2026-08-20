export interface ConnectionDetails {
  serverUrl: string;
  roomName: string;
  participantToken: string;
  participantName: string;
}

const TOKEN_SERVER_URL = import.meta.env.VITE_TOKEN_SERVER_URL ?? 'http://localhost:8080';

export async function fetchConnectionDetails(): Promise<ConnectionDetails> {
  const response = await fetch(`${TOKEN_SERVER_URL}/connection-details`, { method: 'POST' });
  if (!response.ok) {
    throw new Error(`Token server returned ${response.status}`);
  }
  return (await response.json()) as ConnectionDetails;
}
