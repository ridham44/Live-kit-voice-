import { EventEmitter } from 'node:events';

export type PipelineStage = 'llm' | 'knowledge' | 'tts';
export type PipelineStatus = 'ok' | 'error';

export interface PipelineStatusEvent {
  stage: PipelineStage;
  status: PipelineStatus;
  detail?: string;
  timestamp: number;
}

/**
 * A tiny in-process event bus so the LLM/knowledge layers can report their
 * health without importing anything LiveKit-specific. `main.ts` is the only
 * place that knows about LiveKit — it subscribes here and forwards events to
 * the room as data messages for the frontend's status panel.
 */
class StatusBus extends EventEmitter {
  publish(event: Omit<PipelineStatusEvent, 'timestamp'>): void {
    const fullEvent: PipelineStatusEvent = { ...event, timestamp: Date.now() };
    this.emit('status', fullEvent);
  }

  onStatus(listener: (event: PipelineStatusEvent) => void): () => void {
    this.on('status', listener);
    return () => {
      this.off('status', listener);
    };
  }
}

export const statusBus = new StatusBus();
