import {
  APIConnectionError,
  APIStatusError,
  APITimeoutError,
  DEFAULT_API_CONNECT_OPTIONS,
  FunctionCall,
  LLM,
  LLMStream,
  sortedToolEntries,
  toJsonSchema,
  toToolContext,
} from '@livekit/agents';
import type {
  APIConnectOptions,
  ChatChunk,
  ChatContext,
  ToolChoice,
  ToolContext,
  ToolContextLike,
} from '@livekit/agents';
import OpenAI from 'openai';
import { statusBus } from '../status/statusBus.ts';

export interface LocalLLMOptions {
  /** Base URL of an OpenAI-compatible chat completions endpoint (e.g. http://localhost:8000/v1). */
  baseURL?: string;
  /** Model name/identifier as expected by the local server. */
  model?: string;
  /** Most local servers (Ollama, vLLM, LM Studio) ignore this, but some require a placeholder. */
  apiKey?: string;
}

/**
 * LLM adapter for a self-hosted, OpenAI-compatible chat completions endpoint.
 *
 * This is the seam described in the architecture brief: swap `LOCAL_LLM_URL` /
 * `LOCAL_LLM_MODEL` (or the options passed here) to point at your company's real
 * LLM server. LiveKit's transport and voice pipeline are untouched by this class.
 */
export class LocalLLM extends LLM {
  // Undefined when LOCAL_LLM_URL isn't configured — construction never throws (an agent
  // must be constructible before you know whether a local LLM is running yet); instead the
  // first chat() call fails clearly, see LocalLLMStream.run() below.
  private readonly client: OpenAI | undefined;
  private readonly modelName: string;
  private readonly baseURL: string | undefined;

  constructor(opts: LocalLLMOptions = {}) {
    super();
    this.baseURL = opts.baseURL ?? process.env.LOCAL_LLM_URL;
    this.modelName = opts.model ?? process.env.LOCAL_LLM_MODEL ?? '';
    if (this.baseURL) {
      this.client = new OpenAI({
        baseURL: this.baseURL,
        // LOCAL_LLM_API_KEY covers a generic self-hosted server; OPENROUTER_API_KEY is
        // recognized directly so LOCAL_LLM_URL can point at OpenRouter's OpenAI-compatible
        // gateway (https://openrouter.ai/api/v1) without a separate key variable.
        apiKey:
          opts.apiKey ??
          process.env.LOCAL_LLM_API_KEY ??
          process.env.OPENROUTER_API_KEY ??
          'not-needed',
        maxRetries: 0,
      });
      console.log(
        `[local-llm] configured baseURL=${this.baseURL} model=${this.modelName || '(unset)'}`,
      );
    } else {
      console.warn(
        '[local-llm] LOCAL_LLM_URL is not set — generating a reply will fail until it is. ' +
          'Set LOCAL_LLM_URL (and LOCAL_LLM_MODEL) in .env.local to point at your self-hosted ' +
          'OpenAI-compatible endpoint (e.g. http://localhost:8000/v1).',
      );
    }
  }

  label(): string {
    return 'local.LLM';
  }

  override get model(): string {
    return this.modelName || 'unknown';
  }

  override get provider(): string {
    return 'local';
  }

  protected override async _prewarmImpl(signal: AbortSignal): Promise<void> {
    if (!this.client) {
      return;
    }
    await this.client.models.list({ signal });
    console.log(`[local-llm] prewarm reached ${this.baseURL}`);
  }

  chat({
    chatCtx,
    toolCtx: toolCtxInput,
    connOptions,
    parallelToolCalls,
    toolChoice,
    extraKwargs,
  }: {
    chatCtx: ChatContext;
    toolCtx?: ToolContextLike;
    connOptions?: APIConnectOptions;
    parallelToolCalls?: boolean;
    toolChoice?: ToolChoice;
    extraKwargs?: Record<string, unknown>;
  }): LLMStream {
    const toolCtx = toToolContext(toolCtxInput);
    return new LocalLLMStream(this, {
      client: this.client,
      model: this.modelName,
      baseURL: this.baseURL,
      chatCtx,
      toolCtx,
      connOptions: connOptions ?? DEFAULT_API_CONNECT_OPTIONS,
      parallelToolCalls,
      toolChoice,
      extraKwargs,
    });
  }
}

class LocalLLMStream extends LLMStream {
  private readonly client: OpenAI | undefined;
  private readonly modelName: string;
  private readonly baseURL: string | undefined;
  private readonly parallelToolCalls: boolean | undefined;
  private readonly toolChoice: ToolChoice | undefined;
  private readonly extraKwargs: Record<string, unknown>;

  private toolCallId: string | undefined;
  private toolIndex: number | undefined;
  private fncName: string | undefined;
  private fncRawArguments: string | undefined;

  constructor(
    llm: LLM,
    opts: {
      client: OpenAI | undefined;
      model: string;
      baseURL: string | undefined;
      chatCtx: ChatContext;
      toolCtx: ToolContext | undefined;
      connOptions: APIConnectOptions;
      parallelToolCalls: boolean | undefined;
      toolChoice: ToolChoice | undefined;
      extraKwargs: Record<string, unknown> | undefined;
    },
  ) {
    super(llm, {
      chatCtx: opts.chatCtx,
      connOptions: opts.connOptions,
      ...(opts.toolCtx !== undefined ? { toolCtx: opts.toolCtx } : {}),
    });
    this.client = opts.client;
    this.modelName = opts.model;
    this.baseURL = opts.baseURL;
    this.parallelToolCalls = opts.parallelToolCalls;
    this.toolChoice = opts.toolChoice;
    this.extraKwargs = opts.extraKwargs ?? {};
  }

  protected override async run(): Promise<void> {
    const startedAt = Date.now();
    this.toolCallId = this.fncName = this.fncRawArguments = undefined;
    this.toolIndex = undefined;

    if (!this.client || !this.baseURL) {
      const message =
        'LOCAL_LLM_URL is not set. Point it at your self-hosted OpenAI-compatible endpoint ' +
        '(e.g. http://localhost:8000/v1) in .env.local.';
      console.error(`[local-llm] ${message}`);
      statusBus.publish({ stage: 'llm', status: 'error', detail: message });
      throw new APIConnectionError({ message, options: { retryable: false } });
    }
    const client = this.client;
    const baseURL = this.baseURL;

    try {
      const messages = await this.chatCtx.toProviderFormat('openai');
      const toolCtx = this.toolCtx;
      const tools =
        toolCtx && Object.keys(toolCtx.functionTools).length > 0
          ? sortedToolEntries(toolCtx).map(([name, func]) => {
              const parameters: Record<string, unknown> = {
                ...toJsonSchema(func.parameters, true, false),
              };
              delete parameters.$schema;
              return {
                type: 'function' as const,
                function: { name, description: func.description, parameters },
              };
            })
          : undefined;

      console.log(
        `[local-llm] request -> ${baseURL} model=${this.modelName} messages=${messages.length} tools=${tools?.length ?? 0}`,
      );

      // Built as a loosely-typed object because exactOptionalPropertyTypes rejects passing an
      // explicit `undefined` for the OpenAI SDK's optional fields (tool_choice, etc.) — omitting
      // the key entirely (rather than setting it to undefined) is what that SDK's types expect.
      const requestBody: Record<string, unknown> = {
        model: this.modelName,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        ...this.extraKwargs,
      };
      if (tools) {
        requestBody.tools = tools;
        if (this.toolChoice !== undefined) {
          requestBody.tool_choice = this.toolChoice;
        }
        if (this.parallelToolCalls !== undefined) {
          requestBody.parallel_tool_calls = this.parallelToolCalls;
        }
      }

      const stream = await client.chat.completions.create(
        requestBody as unknown as OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming,
        {
          signal: this.abortController.signal,
          timeout: this.connOptions.timeoutMs,
        },
      );

      for await (const chunk of stream) {
        if (this.abortController.signal.aborted) {
          break;
        }
        for (const choice of chunk.choices) {
          const chatChunk = this.parseChoice(chunk.id, choice);
          if (chatChunk) {
            this.queue.put(chatChunk);
          }
        }
        if (chunk.usage) {
          this.queue.put({
            id: chunk.id,
            usage: {
              completionTokens: chunk.usage.completion_tokens ?? 0,
              promptTokens: chunk.usage.prompt_tokens ?? 0,
              promptCachedTokens: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
              totalTokens: chunk.usage.total_tokens ?? 0,
            },
          });
        }
      }
      console.log(`[local-llm] response ok in ${Date.now() - startedAt}ms`);
      statusBus.publish({ stage: 'llm', status: 'ok' });
    } catch (error) {
      if (this.abortController.signal.aborted) {
        return;
      }
      console.error(
        `[local-llm] request to ${baseURL} failed after ${Date.now() - startedAt}ms:`,
        error,
      );
      const message = error instanceof Error ? error.message : String(error);
      statusBus.publish({ stage: 'llm', status: 'error', detail: message });
      if (error instanceof OpenAI.APIConnectionTimeoutError) {
        throw new APITimeoutError({ options: { retryable: true } });
      }
      if (error instanceof OpenAI.APIError) {
        throw new APIStatusError({
          message: `Local LLM at ${baseURL} returned an error: ${error.message}`,
          options: { statusCode: error.status, retryable: true },
        });
      }
      throw new APIConnectionError({
        message: `Local LLM unavailable at ${baseURL}: ${message}`,
        options: { retryable: true },
      });
    }
  }

  private parseChoice(
    id: string,
    choice: OpenAI.Chat.Completions.ChatCompletionChunk['choices'][number],
  ): ChatChunk | undefined {
    const delta = choice.delta;
    if (!delta) {
      return undefined;
    }

    if (delta.tool_calls) {
      for (const toolCall of delta.tool_calls) {
        if (!toolCall.function) {
          continue;
        }
        let callChunk: ChatChunk | undefined;
        if (this.toolCallId && toolCall.id && toolCall.index !== this.toolIndex) {
          callChunk = this.finishToolCall(id);
        }
        if (toolCall.function.name) {
          this.toolIndex = toolCall.index;
          this.toolCallId = toolCall.id;
          this.fncName = toolCall.function.name;
          this.fncRawArguments = toolCall.function.arguments ?? '';
        } else if (toolCall.function.arguments) {
          this.fncRawArguments = (this.fncRawArguments ?? '') + toolCall.function.arguments;
        }
        if (callChunk) {
          return callChunk;
        }
      }
    }

    if (
      choice.finish_reason &&
      ['tool_calls', 'stop'].includes(choice.finish_reason) &&
      this.toolCallId !== undefined
    ) {
      return this.finishToolCall(id);
    }

    if (!delta.content) {
      return undefined;
    }
    return { id, delta: { role: 'assistant', content: delta.content } };
  }

  private finishToolCall(id: string): ChatChunk {
    const chunk: ChatChunk = {
      id,
      delta: {
        role: 'assistant',
        toolCalls: [
          FunctionCall.create({
            callId: this.toolCallId ?? '',
            name: this.fncName ?? '',
            args: this.fncRawArguments ?? '',
          }),
        ],
      },
    };
    this.toolCallId = this.fncName = this.fncRawArguments = undefined;
    return chunk;
  }
}
