/**
 * Anthropic (Claude) provider
 */

import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider, CompletionOptions, CompletionResult, Message, StreamCallback } from "./base.js";

export class AnthropicProvider implements AIProvider {
  id = "anthropic";
  name = "Anthropic";

  private client: Anthropic;
  private lightModel: string;
  private heavyModel: string;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
    this.lightModel = "claude-haiku-4-5";
    this.heavyModel = "claude-sonnet-4-6";
  }

  private extractSystemPrompt(messages: Message[]): { system?: string; messages: Message[] } {
    const system = messages.find((m) => m.role === "system")?.content;
    const filtered = messages.filter((m) => m.role !== "system");
    return { system, messages: filtered };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.lightModel;
    const { system, messages: filtered } = this.extractSystemPrompt(messages);

    const response = await this.client.messages.create({
      model,
      max_tokens: options?.maxTokens ?? 4096,
      system,
      messages: filtered.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    const content = response.content.find((b) => b.type === "text");
    if (!content || content.type !== "text") throw new Error("Empty response from Anthropic");

    return {
      content: content.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      model,
      provider: this.id,
    };
  }

  async stream(messages: Message[], onChunk: StreamCallback, options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.lightModel;
    const { system, messages: filtered } = this.extractSystemPrompt(messages);
    let fullContent = "";
    let inputTokens = 0;
    let outputTokens = 0;

    const stream = await this.client.messages.stream({
      model,
      max_tokens: options?.maxTokens ?? 4096,
      system,
      messages: filtered.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        fullContent += event.delta.text;
        onChunk(event.delta.text);
      }
      if (event.type === "message_delta") {
        outputTokens = event.usage.output_tokens;
      }
      if (event.type === "message_start") {
        inputTokens = event.message.usage.input_tokens;
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
    return [this.lightModel, this.heavyModel];
  }
}
