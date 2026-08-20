import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarVisualizer,
  RoomAudioRenderer,
  useChat,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useTranscriptions,
  useVoiceAssistant,
} from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { MicIcon, SendIcon, TrashIcon } from './icons.tsx';

type PipelineStage = 'llm';
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
  idle: 'Ready',
  listening: 'Listening…',
  thinking: 'Thinking…',
  speaking: 'Speaking…',
};

const EXAMPLE_PROMPTS = [
  'Tell me about the Bugatti Chiron.',
  'What is the fastest Ferrari in the data?',
  'Compare the Bugatti Chiron and the Centodieci.',
  'Tell me something interesting about Bugatti.',
];

export function AssistantView({ onLeave }: { onLeave: () => void }) {
  const { state: agentState, audioTrack } = useVoiceAssistant();
  const connectionState = useConnectionState();
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const transcriptions = useTranscriptions();
  const { send: sendControlMessage } = useDataChannel();
  const { chatMessages, send: sendChatMessage, isSending } = useChat();

  const [pipelineHealth, setPipelineHealth] = useState<Record<PipelineStage, Health>>({
    llm: 'unknown',
  });
  const [clearedAt, setClearedAt] = useState(0);
  const [draft, setDraft] = useState('');

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
    const spoken = transcriptions.map((entry) => ({
      id: entry.streamInfo.id,
      role: (entry.participantInfo.identity === localParticipant.identity ? 'user' : 'assistant') as
        | 'user'
        | 'assistant',
      text: entry.text,
      timestamp: entry.streamInfo.timestamp,
    }));
    const typed = chatMessages
      .filter((message) => message.from?.identity === localParticipant.identity)
      .map((message) => ({
        id: `chat-${message.id}`,
        role: 'user' as const,
        text: message.message,
        timestamp: message.timestamp,
      }));
    return [...spoken, ...typed]
      .filter((entry) => entry.timestamp > clearedAt)
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [transcriptions, chatMessages, clearedAt, localParticipant.identity]);

  const handleStopSpeaking = useCallback(() => {
    void sendControlMessage(new TextEncoder().encode(JSON.stringify({ type: 'stop_speaking' })), {
      reliable: true,
      topic: 'control',
    });
  }, [sendControlMessage]);

  // Push-to-talk: the mic starts disabled (see App.tsx's <LiveKitRoom audio={false}>) so it isn't
  // picking up background noise between turns — that noise was previously enough to trigger false
  // VAD interruptions. The user explicitly starts/stops speaking with this button.
  // When enabling, ask the browser for noise suppression directly on the captured audio (cheap,
  // native to the OS/browser — unlike the on-device ML noise-cancellation model, which was
  // disabled elsewhere for being too CPU-heavy on this hardware). This is on top of the STT
  // provider's own server-side Voice Focus suppression (see src/main.ts).
  const handleToggleMic = useCallback(() => {
    void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled, {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  }, [localParticipant, isMicrophoneEnabled]);

  // Live captions: mirror the user's own in-progress transcript into the text box while they're
  // speaking, so they can see what's being heard. Only while the mic is on, so it never clobbers
  // manual typing.
  useEffect(() => {
    if (!isMicrophoneEnabled) {
      return;
    }
    const ownEntries = transcriptions.filter(
      (entry) => entry.participantInfo.identity === localParticipant.identity,
    );
    if (ownEntries.length === 0) {
      return;
    }
    const latest = ownEntries.reduce((a, b) => (a.streamInfo.timestamp > b.streamInfo.timestamp ? a : b));
    setDraft(latest.text);
  }, [transcriptions, isMicrophoneEnabled, localParticipant.identity]);

  // Once the turn is handed off for a reply, clear the live caption — it's already in the
  // conversation panel below.
  useEffect(() => {
    if (agentState === 'thinking' || agentState === 'speaking') {
      setDraft('');
    }
  }, [agentState]);

  const handleSendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isSending) {
        return;
      }
      void sendChatMessage(trimmed);
      setDraft('');
    },
    [isSending, sendChatMessage],
  );

  const handleTextareaKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSendText(draft);
      }
    },
    [draft, handleSendText],
  );

  const stateLabel = STATE_LABELS[agentState] ?? agentState;
  const orbClassName = [
    'orb-button',
    agentState === 'listening' ? 'orb-button--listening' : '',
    agentState === 'speaking' ? 'orb-button--speaking' : '',
    isMicrophoneEnabled ? '' : 'orb-button--muted',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="main-grid">
      <RoomAudioRenderer />

      <div className="voice-panel glass">
        <div className="status-banner">
          <span>{isMicrophoneEnabled ? stateLabel : 'Mic off — tap to speak'}</span>
          {agentState === 'speaking' && (
            <button type="button" className="status-banner__action" onClick={handleStopSpeaking}>
              Stop
            </button>
          )}
        </div>

        <div className="voice-panel__stage">
          <button
            type="button"
            className={orbClassName}
            onClick={handleToggleMic}
            aria-label={isMicrophoneEnabled ? 'Stop speaking' : 'Start speaking'}
          >
            <MicIcon />
          </button>
          <p className="voice-panel__state-label">
            {isMicrophoneEnabled ? stateLabel : 'Tap to speak'}
          </p>
          <p className="voice-panel__hint">
            {isMicrophoneEnabled
              ? 'Tap the mic again when you’re done speaking.'
              : 'Tap the mic to start speaking, or type a question below.'}
          </p>
        </div>

        <BarVisualizer state={agentState} track={audioTrack} barCount={7} className="assistant__visualizer" />

        <div className="voice-panel__controls">
          <button type="button" className="control-button" onClick={() => setClearedAt(Date.now())}>
            Clear conversation
          </button>
          <button type="button" className="control-button control-button--danger" onClick={onLeave}>
            Disconnect
          </button>
        </div>

        <hr className="divider--dotted" />

        <div className="text-input-row">
          <label className="text-input-row__label" htmlFor="text-input">
            Type or speak a request (Enter to send)
          </label>
          <textarea
            id="text-input"
            rows={2}
            placeholder='e.g. "What is the top speed of the Chiron?"'
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
          />
          <div className="text-input-row__footer">
            <span className="text-input-row__hint">Shift+Enter for a new line</span>
            <button
              type="button"
              className="send-button"
              onClick={() => handleSendText(draft)}
              disabled={!draft.trim() || isSending}
            >
              <SendIcon />
              Send
            </button>
          </div>
        </div>
      </div>

      <StatusPanel connectionState={connectionState} pipelineHealth={pipelineHealth} />

      <TranscriptPanel entries={transcript} onClear={() => setClearedAt(Date.now())} />

      <ExamplePrompts onPick={handleSendText} />
    </div>
  );
}

function StatusPanel({
  connectionState,
  pipelineHealth,
}: {
  connectionState: ConnectionState;
  pipelineHealth: Record<PipelineStage, Health>;
}) {
  return (
    <div className="status-panel glass">
      <p className="status-panel__header">Architecture status</p>
      <StatusRow
        label="LiveKit"
        detail="Realtime Voice Layer"
        health={connectionState === ConnectionState.Connected ? 'ok' : 'unknown'}
        text={connectionStateLabel(connectionState)}
      />
      <StatusRow label="Local LLM" detail="AI Reasoning" health={pipelineHealth.llm} text={healthLabel(pipelineHealth.llm)} />
    </div>
  );
}

function StatusRow({ label, detail, health, text }: { label: string; detail: string; health: Health; text: string }) {
  return (
    <div className="status-row">
      <span className={`status-dot status-dot--${health}`} />
      <div className="status-row__labels">
        <span className="status-row__label">{label}</span>
        <span className="status-row__detail">{detail}</span>
      </div>
      <span className="status-row__text">{text}</span>
    </div>
  );
}

function TranscriptPanel({ entries, onClear }: { entries: TranscriptEntry[]; onClear: () => void }) {
  return (
    <div className="transcript-panel glass">
      <div className="transcript-panel__header">
        <div>
          <p className="transcript-panel__title">Conversation</p>
          <p className="transcript-panel__subtitle">Your spoken or typed requests, and the assistant's replies.</p>
        </div>
        <div className="transcript-panel__actions">
          <button type="button" className="icon-button" onClick={onClear} aria-label="Clear conversation">
            <TrashIcon />
          </button>
        </div>
      </div>
      <div className="transcript">
        {entries.length === 0 ? (
          <p className="transcript__empty">Ask about a Bugatti or Ferrari to get started.</p>
        ) : (
          entries.map((entry) => (
            <div key={entry.id} className={`transcript__row transcript__row--${entry.role}`}>
              {entry.role === 'assistant' && <div className="transcript__avatar">EN</div>}
              <div className="transcript__bubble">
                <p className="transcript__text">{entry.text}</p>
                <span className="transcript__time">
                  {new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function ExamplePrompts({ onPick }: { onPick: (text: string) => void }) {
  return (
    <div className="examples">
      <p className="examples__title">Try asking</p>
      <div className="examples__list">
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button key={prompt} type="button" className="example-chip" onClick={() => onPick(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
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
