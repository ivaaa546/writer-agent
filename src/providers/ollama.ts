/**
 * Ollama provider — connects to local Ollama instance.
 * Also serves as the base for any OpenAI-compatible local endpoint.
 */

import OpenAI from "openai";
import type { AIProvider, CompletionOptions, CompletionResult, Message, StreamCallback } from "./base.js";

export class OllamaProvider implements AIProvider {
  id = "ollama";
  name = "Ollama";

  private client: OpenAI;
  private defaultModel: string;
  private baseUrl: string;

  constructor(opts: { baseUrl?: string; model?: string; providerId?: string; providerName?: string } = {}) {
    this.baseUrl = opts.baseUrl ?? "http://localhost:11434";
    this.defaultModel = opts.model ?? "llama3.2";
    this.id = opts.providerId ?? "ollama";
    this.name = opts.providerName ?? "Ollama";

    // Ollama is OpenAI-compatible — use the OpenAI client with a custom base URL
    this.client = new OpenAI({
      apiKey: "ollama", // required field, not used
      baseURL: `${this.baseUrl}/v1`,
    });
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.defaultModel;

    const response = await this.client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
    });

    const choice = response.choices[0];
    if (!choice?.message?.content) throw new Error("Empty response from Ollama");

    return {
      content: choice.message.content,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      model,
      provider: this.id,
    };
  }

  async stream(messages: Message[], onChunk: StreamCallback, options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.defaultModel;
    let fullContent = "";

    const stream = await this.client.chat.completions.create({
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      max_tokens: options?.maxTokens ?? 4096,
      temperature: options?.temperature ?? 0.7,
      stream: true,
    });

    for await (const chunk of stream) {
      const text = chunk.choices[0]?.delta?.content ?? "";
      if (text) {
        fullContent += text;
        onChunk(text);
      }
    }

    return { content: fullContent, inputTokens: 0, outputTokens: 0, model, provider: this.id };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      return response.ok;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [this.defaultModel];
      const data = await response.json() as { models?: { name: string }[] };
      return data.models?.map((m) => m.name) ?? [this.defaultModel];
    } catch {
      return [this.defaultModel];
    }
  }
}
