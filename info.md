# Info: What This Project Is

## What we are

This is **Enzo**, a voice AI assistant built on the **LiveKit Agents Node.js SDK**,
running against **LiveKit Cloud**. It's a demonstration/starter app that shows a
specific architectural point: LiveKit only handles realtime audio transport — the
"brain" (the LLM) behind the voice is a separate, swappable piece.

The app has three moving parts that run together (`pnpm run demo`):

| Process      | File                                     | Job                                                                |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------ |
| Token server | [src/tokenServer.ts](src/tokenServer.ts) | Mints LiveKit room tokens so the frontend can join a room          |
| Voice agent  | [src/main.ts](src/main.ts)               | The actual LiveKit Agent — joins the room, runs the voice pipeline |
| Frontend     | [frontend/](frontend/)                   | Vite + React app: mic button, live captions, status panel          |

## Why

The point of this repo is to prove a decoupling: **you can bring your own LLM**
(self-hosted, a company's internal model, or any OpenAI-compatible endpoint)
without touching LiveKit's transport, voice pipeline, turn detection, or frontend
at all. Everything LLM-related lives behind one class:
[src/llm/localLlm.ts](src/llm/localLlm.ts) (`LocalLLM`), wired in at
[src/agent.ts:53](src/agent.ts#L53). Today it's pointed at OpenRouter
(`openai/gpt-4o-mini`) as a stand-in for a real self-hosted/company LLM — swapping
providers is just changing `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` env vars.

## Role of LiveKit Agents in the system

LiveKit Agents is **not** the LLM and does **not** generate the assistant's
answers. Its job is everything around the conversation:

1. **Realtime transport** — creates/joins the LiveKit "room" (a WebRTC session)
   that carries audio between the browser and the agent process
   ([src/main.ts:99](src/main.ts#L99), `ctx.connect()`)
2. **The voice pipeline** (`voice.AgentSession`, [src/main.ts:18](src/main.ts#L18)) — orchestrates:
   - **STT (ears)**: AssemblyAI Universal-3.5 Pro via LiveKit Inference, tuned for
     low latency (`mode: 'min_latency'`) and background-noise suppression
     (`voice_focus: 'far-field'`)
   - **LLM (brain)**: handed off entirely to `LocalLLM` — LiveKit just calls
     `chat()` on whatever `LLM` subclass you give it
   - **TTS (voice)**: Fish Audio S2.1 Pro via LiveKit Inference, with **expressive
     mode** — the framework injects the TTS provider's markup guide into the LLM
     prompt so the model emits inline delivery tags (emotion, pacing, non-verbal
     sounds) that TTS renders as audio but the transcript never shows
3. **Turn detection & interruption** — LiveKit's built-in multimodal turn
   detector (`inference.TurnDetector()`) decides when the user has actually
   finished speaking. Adaptive interruption (`minWords: 2`, `minDuration: 600`)
   distinguishes a real interruption from a backchannel ("mhm", "right") or noise
   pickup, tuned specifically to avoid a runaway interrupt/regenerate loop seen
   on noisy mics
4. **Barge-in** — both voice-triggered (via turn detection) and a manual
   `stop_speaking` data message from the frontend's "Stop speaking" button, both
   routed through `session.interrupt()`
5. **Process/job lifecycle** — `cli.runApp` forks a Node process per job/session,
   handles job scheduling from LiveKit Cloud, prewarming, and timeouts
   (`initializeProcessTimeout: 60_000` for this app's cold-start dependency load)
6. **Data channel messaging** — the agent publishes pipeline health events
   (LLM ok/error) as reliable data messages on the `pipeline-status` topic, which
   the frontend's status panel consumes ([src/status/statusBus.ts](src/status/statusBus.ts))
7. **Tool calling** — `Agent.create({ tools: [...] })` lets the LLM call
   functions (e.g. a weather lookup); LiveKit Agents handles the tool-call
   protocol translation between the LLM's function-calling format and structured
   execution. Not currently used in this app but scaffolded/commented in
   [src/agent.ts:64-87](src/agent.ts#L64-L87)

## What else LiveKit Agents can do (beyond what this app currently uses)

- **Realtime models**: swap the STT→LLM→TTS pipeline for a single realtime
  speech-to-speech model (e.g. OpenAI Realtime API) — commented example at
  [src/agent.ts:55-62](src/agent.ts#L55-L62)
- **Handoffs / multi-agent workflows**: one agent can hand off control to another
  agent mid-conversation, so a complex assistant can be built as several small,
  narrowly-scoped agents instead of one giant prompt. Recommended by
  [AGENTS.md](AGENTS.md) for anything beyond a single-phase conversation
- **Virtual avatars**: video avatar providers (e.g. Anam) can be attached to a
  session so the voice is paired with an animated face — commented example at
  [src/main.ts:87-96](src/main.ts#L87-L96)
- **Noise cancellation**: on-device ML background voice/noise suppression
  (`@livekit/plugins-ai-coustics`) — installed but disabled in this app because
  it was too CPU-heavy alongside the turn detector on this machine
  ([src/main.ts:2](src/main.ts#L2), see note near `session.start`)
- **50+ swappable models** across STT/TTS/LLM/realtime/avatar via LiveKit
  Inference — see https://docs.livekit.io/agents/models
- **Telephony**: inbound/outbound phone calling can be added to any agent
  (SIP trunks etc.), independent of the web frontend
- **Any frontend/platform**: this repo ships its own React frontend, but the
  same agent works with LiveKit's pre-built starters for iOS/macOS, Flutter,
  React Native, Android, or a web embed widget
- **Evals/testing framework**: LiveKit Agents has a built-in testing &
  evaluation framework for agent behavior (`.test.ts` files, run via `pnpm test`)
  — [src/agent.test.ts](src/agent.test.ts) is this app's example
- **LiveKit CLI (`lk`)**: beyond docs search, manages deployment, SIP trunks,
  and other project/cloud administration tasks from the terminal

## Current LLM configuration

```
LOCAL_LLM_URL=https://openrouter.ai/api/v1
LOCAL_LLM_MODEL=openai/gpt-4o-mini
```

This is read by `LocalLLM` ([src/llm/localLlm.ts](src/llm/localLlm.ts)), which wraps
any OpenAI-compatible chat completions endpoint (streaming, tool calls, usage
tracking) behind LiveKit's `LLM`/`LLMStream` interface. `OPENROUTER_API_KEY` is
recognized directly so OpenRouter works without a separate `LOCAL_LLM_API_KEY`
variable.
