<a href="https://livekit.io/">
  <img src="./.github/assets/livekit-mark.png" alt="LiveKit logo" width="100" height="100">
</a>

# LiveKit Agents Starter - Node.js

A complete starter project for building voice AI apps with [LiveKit Agents for Node.js](https://github.com/livekit/agents-js) and [LiveKit Cloud](https://cloud.livekit.io/), customized into **Enzo** — a voice assistant demo built to show one thing clearly: LiveKit handles realtime transport only, and the LLM behind it is an independent, swappable component.

What's included:

- **Enzo**, a voice assistant with push-to-talk mic control and live captions of what it hears
- Speech-to-text (AssemblyAI Universal-3.5 Pro) and text-to-speech (Fish Audio S2.1 Pro) via [LiveKit Inference](https://docs.livekit.io/agents/models/inference) — zero-config, and swappable for any of the [50+ supported models](https://docs.livekit.io/agents/models)
- A custom LLM adapter (`src/llm/localLlm.ts`) instead of LiveKit's hosted inference — any OpenAI-compatible chat completions endpoint can sit behind it. It's currently pointed at OpenRouter as a stand-in for a self-hosted/company LLM; see [Architecture](#architecture) for the exact swap point
- Expressive mode, enabled by default: the framework injects the TTS provider's markup guide into the LLM prompt, so the model emits inline delivery tags (emotion, pacing, non-verbal sounds) that the TTS renders and the transcript never shows
- [LiveKit Turn Detector](https://docs.livekit.io/agents/logic/turns/turn-detector/) with adaptive interruption tuned (`minWords: 2`, `minDuration: 600`) to avoid false triggers from background noise
- A polished, glassmorphism React frontend (`frontend/`) with a voice orb, live transcript, and an architecture status panel — see [Frontend & Telephony](#frontend--telephony)
- A minimal token-minting server (`src/tokenServer.ts`) the frontend uses to join LiveKit rooms
- Eval suite based on the LiveKit Agents [testing & evaluation framework](https://docs.livekit.io/agents/start/testing)
- A Dockerfile ready for [production deployment to LiveKit Cloud](https://docs.livekit.io/deploy/agents/)

[Background voice cancellation](https://docs.livekit.io/transport/media/noise-cancellation/) is wired into `src/main.ts` but commented out by default: it runs a second on-device ML model on every audio frame, which was too CPU-heavy alongside the turn detector on constrained hardware. Re-enable it (see the comment at that spot in `src/main.ts`) if you're running on a machine with more headroom.

## Architecture

LiveKit only handles realtime transport — audio, the room/session, and interruption/barge-in. Everything else is an independently swappable piece:

| Layer          | Where                              | Notes                                                                                                                                                       |
| -------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| STT            | `src/main.ts` (`inference.STT`)    | AssemblyAI Universal-3.5 Pro, tuned for low latency (`mode: 'min_latency'`) and background-noise suppression (`voice_focus: 'far-field'`)                   |
| **LLM**        | `src/llm/localLlm.ts` (`LocalLLM`) | **The swap point.** Point `LOCAL_LLM_URL` (and `LOCAL_LLM_MODEL`) at your own self-hosted or company LLM server — nothing else in the agent needs to change |
| TTS            | `src/main.ts` (`inference.TTS`)    | Fish Audio S2.1 Pro, with expressive mode enabled                                                                                                           |
| Turn detection | `src/main.ts` (`turnHandling`)     | LiveKit's built-in audio turn detector + adaptive interruption                                                                                              |
| Frontend       | `frontend/`                        | Vite + React app; status panel is driven by data messages the agent publishes via `src/status/statusBus.ts`                                                 |
| Token server   | `src/tokenServer.ts`               | Minimal HTTP server the frontend calls to mint LiveKit room tokens                                                                                          |

This starter app is compatible with any [custom web/mobile frontend](https://docs.livekit.io/frontends/) or [telephony](https://docs.livekit.io/telephony/), though this repo already ships with its own (see below).

## Using coding agents

This project is designed to work with coding agents like [Claude Code](https://claude.com/product/claude-code), [Cursor](https://www.cursor.com/), and [Codex](https://openai.com/codex/).

For your convenience, LiveKit offers both a CLI and an [MCP server](https://docs.livekit.io/reference/developer-tools/docs-mcp/) that can be used to browse and search its documentation. The [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/) (`lk docs`) works with any coding agent that can run shell commands. Install it for your platform:

**macOS:**

```console
brew install livekit-cli
```

**Linux:**

```console
curl -sSL https://get.livekit.io/cli | bash
```

**Windows:**

```console
winget install LiveKit.LiveKitCLI
```

The `lk docs` subcommand requires version 2.15.0 or higher. Check your version with `lk --version` and update if needed. Once installed, your coding agent can search and browse LiveKit documentation directly from the terminal:

```console
lk docs search "voice agents"
lk docs get-page /agents/start/voice-ai-quickstart
```

See the [Coding agent support](https://docs.livekit.io/intro/coding-agents/) guide for more details, including MCP server setup.

The project includes a complete [AGENTS.md](AGENTS.md) file for these assistants. You can modify this file to suit your needs. To learn more about this file, see [https://agents.md](https://agents.md).

## Dev Setup

This project uses [pnpm](https://pnpm.io/) as the package manager, in a workspace covering both the agent (repo root) and the frontend (`frontend/`).

Clone the repository and install dependencies:

```console
git clone https://github.com/ridham44/Live-kit-voice-.git
cd Live-kit-voice-
pnpm install
```

Sign up for [LiveKit Cloud](https://cloud.livekit.io/), then copy `.env.example` to `.env.local` at the repo root and fill in:

- `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — from your LiveKit Cloud project settings, or load them automatically with the [LiveKit CLI](https://docs.livekit.io/intro/basics/cli/): `lk cloud auth && lk app env -w -d .env.local`
- `LOCAL_LLM_URL` / `LOCAL_LLM_MODEL` — the OpenAI-compatible chat completions endpoint and model to use as the LLM (see [Architecture](#architecture))
- `LOCAL_LLM_API_KEY` or `OPENROUTER_API_KEY` — whichever your endpoint needs; `OPENROUTER_API_KEY` is recognized directly when `LOCAL_LLM_URL` points at `https://openrouter.ai/api/v1`
- `TOKEN_SERVER_PORT` — defaults to `8080`

Then copy `frontend/.env.example` to `frontend/.env.local` if the token server won't be running at the default `http://localhost:8080`.

## Running the agent

This repo has three processes: the token server, the voice agent, and the frontend. Run all three together with:

```console
pnpm run demo
```

Or run them individually, each in its own terminal:

```console
pnpm run token-server        # mints LiveKit room tokens for the frontend
pnpm run dev                 # the voice agent, in development mode
pnpm --filter frontend dev   # the React frontend, at http://localhost:5173
```

In production, start the agent with `pnpm run start` instead of `pnpm run dev`.

## Frontend & Telephony

This repo already includes a web frontend at [`frontend/`](frontend/) — a Vite + React app with a push-to-talk mic, live captions, and an architecture status panel. Run it with `pnpm --filter frontend dev`, or as part of `pnpm run demo`.

If you'd rather build your own frontend, or need a different platform, LiveKit also offers pre-built starter apps, or add telephony support:

| Platform         | Link                                                                                                                | Description                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| **Web**          | [`livekit-examples/agent-starter-react`](https://github.com/livekit-examples/agent-starter-react)                   | Web voice AI assistant with React & Next.js        |
| **iOS/macOS**    | [`livekit-examples/agent-starter-swift`](https://github.com/livekit-examples/agent-starter-swift)                   | Native iOS, macOS, and visionOS voice AI assistant |
| **Flutter**      | [`livekit-examples/agent-starter-flutter`](https://github.com/livekit-examples/agent-starter-flutter)               | Cross-platform voice AI assistant app              |
| **React Native** | [`livekit-examples/voice-assistant-react-native`](https://github.com/livekit-examples/voice-assistant-react-native) | Native mobile app with React Native & Expo         |
| **Android**      | [`livekit-examples/agent-starter-android`](https://github.com/livekit-examples/agent-starter-android)               | Native Android app with Kotlin & Jetpack Compose   |
| **Web Embed**    | [`livekit-examples/agent-starter-embed`](https://github.com/livekit-examples/agent-starter-embed)                   | Voice AI widget for any website                    |
| **Telephony**    | [Documentation](https://docs.livekit.io/telephony/)                                                                 | Add inbound or outbound calling to your agent      |

For advanced customization, see the [complete frontend guide](https://docs.livekit.io/frontends/).

## Deploying to production

This project is production-ready and includes a working `Dockerfile`. To deploy it to LiveKit Cloud or another environment, see the [deploying to production](https://docs.livekit.io/deploy/agents/) guide.

## Self-hosted LiveKit

You can also self-host LiveKit instead of using LiveKit Cloud. See the [self-hosting](https://docs.livekit.io/transport/self-hosting/local/) guide for more information. If you choose to self-host, you'll need to also use [model plugins](https://docs.livekit.io/agents/models/#plugins) instead of LiveKit Inference and will need to remove the [LiveKit Cloud noise cancellation](https://docs.livekit.io/transport/media/noise-cancellation/) plugin.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
