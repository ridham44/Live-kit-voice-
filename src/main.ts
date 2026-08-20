import { ServerOptions, cli, defineAgent, inference, voice } from '@livekit/agents';
import { audioEnhancement } from '@livekit/plugins-ai-coustics';
import { RoomEvent } from '@livekit/rtc-node';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createAgent } from './agent.ts';
import { statusBus } from './status/statusBus.ts';

// Load environment variables from a local file.
// Make sure to set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET
// when running locally or self-hosting your agent server.
dotenv.config({ path: '.env.local' });

export default defineAgent({
  entry: async (ctx) => {
    // Set up a voice AI pipeline using AssemblyAI, Fish Audio, and the LiveKit turn detector
    const session = new voice.AgentSession({
      // Speech-to-text (STT) is your agent's ears, turning the user's speech into text that the LLM can understand
      // See all available models at https://docs.livekit.io/agents/models/stt/
      stt: new inference.STT({
        model: 'assemblyai/universal-3-5-pro',
        language: 'en',
      }),

      // Text-to-speech (TTS) is your agent's voice, turning the LLM's text into speech that the user can hear
      // See all available models as well as voice selections at https://docs.livekit.io/agents/models/tts/
      tts: new inference.TTS({
        model: 'fishaudio/s2.1-pro',
        voice: 'fa4c9eb3dccc4806b382b40d61c6b10a',
      }),

      turnHandling: {
        // Turn detection determines when the user is speaking and when the agent should respond.
        // The LiveKit audio turn detector is a multimodal model that encodes the user's audio
        // directly to predict end of turn. It's built into the SDK (no extra plugin) and
        // AgentSession supplies the required VAD automatically.
        // See more at https://docs.livekit.io/agents/logic/turns/turn-detector/
        turnDetection: new inference.TurnDetector(),
        // Adaptive interruptions use the turn detector to tell a real interruption from a
        // backchannel like "mhm" or "right", so the agent keeps talking through the latter.
        interruption: { mode: 'adaptive' },
        // Allow the LLM to generate a response while waiting for the end of turn
        preemptiveGeneration: { enabled: true },
      },

      // Expressive mode injects the TTS provider's markup guide into the LLM prompt, so the model
      // emits inline delivery tags (emotion, pacing, non-verbal sounds) that the TTS renders and
      // the transcript never shows. Requires a TTS model that supports markup, such as the Fish
      // Audio model above.
      expressive: true,
    });

    // Start the session, which initializes the voice pipeline and warms up the models
    await session.start({
      agent: createAgent(),
      room: ctx.room,
      inputOptions: {
        // ai-coustics QUAIL audio enhancement for noise cancellation
        // Works for both WebRTC and telephony (SIP) participants
        noiseCancellation: audioEnhancement({ model: 'quailVfS' }),
      },
    });

    // // Add a virtual avatar to the session, if desired
    // // For other providers, see https://docs.livekit.io/agents/models/avatar/
    // const avatar = new anam.AvatarSession({
    //   personaConfig: {
    //     name: '...',
    //     avatarId: '...', // See https://docs.livekit.io/agents/models/avatar/plugins/anam
    //   },
    // });
    // // Start the avatar and wait for it to join
    // await avatar.start(session, ctx.room);

    // Join the room and connect to the user
    await ctx.connect();
    console.log(`[main] connected to LiveKit room "${ctx.room.name}"`);

    // Forward local LLM / knowledge pipeline health to the frontend's status panel.
    // This is the only place that knows about both LiveKit and the status bus — the LLM and
    // knowledge modules stay unaware of LiveKit entirely (see src/status/statusBus.ts).
    const unsubscribeStatus = statusBus.onStatus((event) => {
      const participant = ctx.room.localParticipant;
      if (!participant) {
        return;
      }
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: 'pipeline_status', ...event }),
      );
      participant
        .publishData(payload, { reliable: true, topic: 'pipeline-status' })
        .catch((error: unknown) =>
          console.error('[main] failed to publish pipeline status:', error),
        );
    });
    ctx.room.on(RoomEvent.Disconnected, () => unsubscribeStatus());

    // Let the frontend's manual "Stop speaking" button trigger a real barge-in,
    // independent of voice-based interruption (turnHandling.interruption above).
    ctx.room.on(RoomEvent.DataReceived, (payload) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payload)) as { type?: string };
        if (message.type === 'stop_speaking') {
          console.log('[main] received stop_speaking from frontend, interrupting agent speech');
          session.interrupt();
        }
      } catch (error) {
        console.error('[main] failed to parse incoming data message:', error);
      }
    });

    // Greet the user on joining
    session.generateReply({
      instructions: 'Greet the user in a helpful and friendly manner.',
    });
  },
});

// Run the agent server
cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: 'my-agent',
  }),
);
