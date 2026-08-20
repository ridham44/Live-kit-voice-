import { useCallback, useState } from 'react';
import { LiveKitRoom } from '@livekit/components-react';
import type { DisconnectReason } from 'livekit-client';
import { fetchConnectionDetails } from './api.ts';
import type { ConnectionDetails } from './api.ts';
import { AssistantView } from './AssistantView.tsx';
import { MicIcon } from './icons.tsx';

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
        <div className="page__header-row">
          <h1 className="page__title">Enzo</h1>
          <span className="pill">
            <span className={`pill__dot${inRoom ? ' pill__dot--ok' : ''}`} />
            {inRoom ? 'Active' : phase === 'connecting' ? 'Connecting' : 'Idle'}
          </span>
          <span className="pill">Bugatti · Ferrari</span>
          <span className="pill">Local LLM</span>
        </div>
        <p className="page__subtitle">
          Ask about Bugatti or Ferrari — press the mic to talk, or type below.
        </p>
      </header>

      {!inRoom ? (
        <div className="landing glass">
          <button
            type="button"
            className="orb-button"
            onClick={handleConnect}
            disabled={phase === 'connecting'}
            aria-label="Start voice session"
          >
            <MicIcon />
          </button>
          <p className="landing__hint">
            {phase === 'connecting' ? 'Connecting…' : 'Tap the mic to start a session'}
          </p>
          {errorMessage && <p className="landing__error">{errorMessage}</p>}
        </div>
      ) : (
        <LiveKitRoom
          serverUrl={connectionDetails.serverUrl}
          token={connectionDetails.participantToken}
          connect
          audio={false}
          video={false}
          onDisconnected={handleDisconnected}
          onError={handleRoomError}
          style={{ width: '100%' }}
        >
          <AssistantView onLeave={handleLeave} />
        </LiveKitRoom>
      )}
    </div>
  );
}
