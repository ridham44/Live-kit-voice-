import { useCallback, useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import type { DisconnectReason } from 'livekit-client';
import { fetchConnectionDetails } from './api.ts';
import type { ConnectionDetails } from './api.ts';
import { AssistantView } from './AssistantView.tsx';

type Phase = 'idle' | 'connecting' | 'connected' | 'error';

export function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [connectionDetails, setConnectionDetails] = useState<ConnectionDetails | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleConnect = useCallback(async () => {
    setPhase('connecting');
    setErrorMessage(null);
    try {
      const details = await fetchConnectionDetails();
      setConnectionDetails(details);
      setPhase('connected');
    } catch (error) {
      console.error('[app] failed to fetch connection details:', error);
      setErrorMessage(
        'Could not reach the token server. Make sure it is running (pnpm run token-server from the repo root) and VITE_TOKEN_SERVER_URL is correct.',
      );
      setPhase('error');
    }
  }, []);

  const handleLeave = useCallback(() => {
    setPhase('idle');
    setConnectionDetails(null);
  }, []);

  const handleDisconnected = useCallback((reason?: DisconnectReason) => {
    console.warn('[app] disconnected from room, reason:', reason);
    setPhase('idle');
    setConnectionDetails(null);
  }, []);

  const handleRoomError = useCallback((error: Error) => {
    console.error('[app] room error:', error);
    setErrorMessage(error.message);
    setPhase('error');
  }, []);

  const inRoom = phase === 'connected' && connectionDetails !== null;

  return (
    <div className="page">
      <header className="page__header">
        <p className="page__eyebrow">LiveKit Voice AI Demo</p>
        <h1 className="page__title">Bugatti × Ferrari Intelligence</h1>
        {!inRoom && <p className="page__subtitle">Ask me about Bugatti or Ferrari</p>}
      </header>

      {!inRoom || !connectionDetails ? (
        <div className="landing">
          <button
            type="button"
            className="mic-button"
            onClick={handleConnect}
            disabled={phase === 'connecting'}
            aria-label="Start voice session"
          >
            {phase === 'connecting' ? '…' : '🎤'}
          </button>
          <p className="landing__hint">
            {phase === 'connecting' ? 'Connecting to LiveKit…' : 'Tap the microphone to start talking'}
          </p>
          {errorMessage && <p className="landing__error">{errorMessage}</p>}
        </div>
      ) : (
        <LiveKitRoom
          serverUrl={connectionDetails.serverUrl}
          token={connectionDetails.participantToken}
          connect
          audio
          video={false}
          onDisconnected={handleDisconnected}
          onError={handleRoomError}
          className="room"
        >
          <AssistantView onLeave={handleLeave} />
        </LiveKitRoom>
      )}

      <footer className="page__footer">
        <span>LiveKit — Realtime Voice Layer</span>
        <span>Local LLM — AI Reasoning</span>
        <span>Local Knowledge — Bugatti/Ferrari Data</span>
        <span>MCP / Tools — Data Access Layer</span>
      </footer>
    </div>
  );
}
