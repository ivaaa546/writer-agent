/**
 * OpenAI provider — supports both API Key and OAuth (Codex) tokens.
 * Also used as base for GitHub Copilot (OpenAI-compatible API).
 */

import OpenAI from "openai";
import type { AIProvider, CompletionOptions, CompletionResult, Message, StreamCallback } from "./base.js";

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI";

  protected client: OpenAI;
  protected defaultLightModel: string;
  protected defaultHeavyModel: string;

  constructor(opts: {
    apiKey: string;
    baseUrl?: string;
    providerId?: string;
    providerName?: string;
    lightModel?: string;
    heavyModel?: string;
  }) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      // Allow non-sk-... keys (e.g. OAuth JWT Bearer tokens)
      dangerouslyAllowBrowser: true,
    });
    this.id = opts.providerId ?? "openai";
    this.name = opts.providerName ?? "OpenAI";
    this.defaultLightModel = opts.lightModel ?? "gpt-4o-mini";
    this.defaultHeavyModel = opts.heavyModel ?? "gpt-4o";
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.defaultLightModel;

    const response = await this.client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) throw new Error("Empty response from OpenAI");

    return {
      content: choice.message.content,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      model,
      provider: this.id,
    };
  }

  async stream(messages: Message[], onChunk: StreamCallback, options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.defaultLightModel;
    let fullContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await this.client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
      stream_options: { include_usage: true },
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        fullContent += text;
        onChunk(text);
      }
      if (chunk.usage) {
        inputTokens = chunk.usage.prompt_tokens;
        outputTokens = chunk.usage.completion_tokens;
      }
    }

    return { content: fullContent, inputTokens, outputTokens, model, provider: this.id };
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.models.list();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const models = await this.client.models.list();
      return models.data.map((m) => m.id);
    } catch {
      return [this.defaultLightModel, this.defaultHeavyModel];
    }
  }
}
