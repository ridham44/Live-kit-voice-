import { useCallback, useMemo, useState } from 'react';
import {
  BarVisualizer,
  RoomAudioRenderer,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';

type PipelineStage = 'llm' | 'knowledge' | 'tts';
type Health = 'unknown' | 'ok' | 'error';

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: number;
}

const STATE_LABELS: Record<string, string> = {
  disconnected: 'Disconnected',
  connecting: 'Connecting…',
  'pre-connect-buffering': 'Connecting…',
  failed: 'Connection failed',
  initializing: 'Warming up…',
  idle: 'Ask me about Bugatti or Ferrari',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

export function AssistantView({ onLeave }: { onLeave: () => void }) {
  const { state: agentState, audioTrack, agent } = useVoiceAssistant();
  const connectionState = useConnectionState();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const transcriptions = useTranscriptions();
  const { send: sendControlMessage } = useDataChannel();

  const [pipelineHealth, setPipelineHealth] = useState<Record<PipelineStage, Health>>({
    llm: 'unknown',
    knowledge: 'unknown',
    tts: 'unknown',
  });
  const [clearedAt, setClearedAt] = useState(0);

  const handlePipelineStatus = useCallback((msg: { payload: Uint8Array }) => {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(msg.payload)) as {
        type?: string;
        stage?: PipelineStage;
        status?: Health;
      };
      if (decoded.type === 'pipeline_status' && decoded.stage && decoded.status) {
        setPipelineHealth((prev) => ({ ...prev, [decoded.stage as PipelineStage]: decoded.status as Health }));
      }
    } catch {
      // ignore malformed status messages
    }
  }, []);
  useDataChannel('pipeline-status', handlePipelineStatus);

  const transcript = useMemo<TranscriptEntry[]>(() => {
    return transcriptions
      .filter((entry) => entry.streamInfo.timestamp > clearedAt)
      .map((entry) => ({
        id: entry.streamInfo.id,
        role: (entry.participantInfo.identity === localParticipant.identity ? 'user' : 'assistant') as
          | 'user'
          | 'assistant',
        text: entry.text,
        timestamp: entry.streamInfo.timestamp,
      }))
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [transcriptions, clearedAt, localParticipant.identity]);

  const handleStopSpeaking = useCallback(() => {
    void sendControlMessage(new TextEncoder().encode(JSON.stringify({ type: 'stop_speaking' })), {
      reliable: true,
      topic: 'control',
    });
  }, [sendControlMessage]);

  const handleToggleMute = useCallback(() => {
    void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }, [localParticipant, isMicrophoneEnabled]);

  const stateLabel = STATE_LABELS[agentState] ?? agentState;

  return (
    <div className="assistant">
      <RoomAudioRenderer />

      <div className="assistant__stage">
        <BarVisualizer state={agentState} track={audioTrack} barCount={7} className="assistant__visualizer" />
        <p className="assistant__state-label" data-state={agentState}>
          {stateLabel}
        </p>
      </div>

      <div className="assistant__controls">
        <button
          type="button"
          className={`control-button${isMicrophoneEnabled ? '' : ' control-button--active'}`}
          onClick={handleToggleMute}
        >
          {isMicrophoneEnabled ? 'Mute' : 'Unmute'}
        </button>
        <button
          type="button"
          className="control-button"
          onClick={handleStopSpeaking}
          disabled={agentState !== 'speaking'}
        >
          Stop speaking
        </button>
        <button type="button" className="control-button" onClick={() => setClearedAt(Date.now())}>
          Clear conversation
        </button>
        <button type="button" className="control-button control-button--danger" onClick={onLeave}>
          Disconnect
        </button>
      </div>

      <div className="transcript">
        {transcript.length === 0 ? (
          <p className="transcript__empty">Ask about a Bugatti or Ferrari to get started.</p>
        ) : (
          transcript.map((entry) => (
            <div key={entry.id} className={`transcript__entry transcript__entry--${entry.role}`}>
              <span className="transcript__role">{entry.role === 'user' ? 'You' : 'Assistant'}</span>
              <p className="transcript__text">{entry.text}</p>
            </div>
          ))
        )}
      </div>

      <StatusPanel connectionState={connectionState} pipelineHealth={pipelineHealth} agentConnected={Boolean(agent)} />
    </div>
  );
}

function StatusPanel({
  connectionState,
  pipelineHealth,
  agentConnected,
}: {
  connectionState: ConnectionState;
  pipelineHealth: Record<PipelineStage, Health>;
  agentConnected: boolean;
}) {
  return (
    <div className="status-panel">
      <StatusRow
        label="LiveKit"
        detail="Realtime Voice Layer"
        health={connectionState === ConnectionState.Connected ? 'ok' : 'unknown'}
        text={connectionStateLabel(connectionState)}
      />
      <StatusRow label="Local LLM" detail="AI Reasoning" health={pipelineHealth.llm} text={healthLabel(pipelineHealth.llm)} />
      <StatusRow
        label="Local Knowledge"
        detail="Bugatti / Ferrari Data"
        health={pipelineHealth.knowledge}
        text={healthLabel(pipelineHealth.knowledge)}
      />
      <StatusRow label="MCP / Tools" detail="Data Access Layer" health={agentConnected ? 'ok' : 'unknown'} text="Ready" />
    </div>
  );
}

function StatusRow({ label, detail, health, text }: { label: string; detail: string; health: Health; text: string }) {
  return (
    <div className="status-row">
      <div className="status-row__labels">
        <span className="status-row__label">{label}</span>
        <span className="status-row__detail">{detail}</span>
      </div>
      <span className={`status-dot status-dot--${health}`} />
      <span className="status-row__text">{text}</span>
    </div>
  );
}

function connectionStateLabel(state: ConnectionState): string {
  switch (state) {
    case ConnectionState.Connected:
      return 'Connected';
    case ConnectionState.Connecting:
      return 'Connecting…';
    case ConnectionState.Reconnecting:
    case ConnectionState.SignalReconnecting:
      return 'Reconnecting…';
    default:
      return 'Disconnected';
  }
}

function healthLabel(health: Health): string {
  switch (health) {
    case 'ok':
      return 'Online';
    case 'error':
      return 'Unavailable';
    default:
      return 'Waiting…';
  }
}
