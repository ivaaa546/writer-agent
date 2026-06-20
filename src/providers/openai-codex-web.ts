/**
 * Custom Web Provider for OpenAI Codex
 * Interacts with https://chatgpt.com/backend-api/codex/responses
 */

import type { AIProvider, CompletionOptions, CompletionResult, Message, StreamCallback } from "./base.js";

export class OpenAICodexWebProvider implements AIProvider {
  id = "openai-codex";
  name = "ChatGPT Plus/Pro (Codex Web)";
  
  protected accessToken: string;
  protected defaultLightModel: string;
  protected defaultHeavyModel: string;

  constructor(opts: {
    accessToken: string;
    lightModel?: string;
    heavyModel?: string;
  }) {
    this.accessToken = opts.accessToken;
    this.defaultLightModel = opts.lightModel ?? "gpt-5.4-mini";
    this.defaultHeavyModel = opts.heavyModel ?? "gpt-5.4";
  }

  private buildPayload(messages: Message[], model: string, stream: boolean) {
    let instructions = "";
    const input: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        instructions += (instructions ? "\n" : "") + msg.content;
      } else {
        const contentType = msg.role === "assistant" ? "output_text" : "input_text";
        input.push({
          role: msg.role,
          content: [{ type: contentType, text: msg.content }],
        });
      }
    }

    return {
      model,
      stream,
      store: false,
      instructions,
      input,
    };
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.defaultLightModel;
    
    // We implement complete by consuming the stream for simplicity 
    // to avoid duplicating SSE parsing logic vs standard JSON parsing logic
    let fullText = "";
    await this.stream(messages, (chunk) => { fullText += chunk; }, { ...options, model });
    
    return {
      content: fullText,
      inputTokens: 0,
      outputTokens: 0,
      model,
      provider: this.id,
    };
  }

  async stream(messages: Message[], onChunk: StreamCallback, options?: CompletionOptions): Promise<CompletionResult> {
    const model = options?.model ?? this.defaultLightModel;
    const payload = this.buildPayload(messages, model, true);

    const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Error en Codex Web stream (${response.status}): ${text}`);
    }

    if (!response.body) {
      throw new Error("No response body in stream");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let fullContent = "";

    let inputTokens = 0;
    let outputTokens = 0;

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          const lines = part.split("\n");
          let dataStr = "";
          for (const line of lines) {
            if (line.trim().startsWith("data: ")) {
              dataStr = line.trim().slice(6).trim();
              break;
            }
          }
          
          if (!dataStr || dataStr === "[DONE]") continue;

          try {
            const data = JSON.parse(dataStr);
            
            // Extract token usage if available
            if (data.type === "response.completed" && data.response?.usage) {
              inputTokens = data.response.usage.input_tokens ?? inputTokens;
              outputTokens = data.response.usage.output_tokens ?? outputTokens;
            }
            
            let textChunk = "";
            if (data.type === "response.output_text.delta" && typeof data.delta === "string") {
              textChunk = data.delta;
            } else if (data.message?.content?.parts?.[0]) {
              // Usually the backend API returns accumulated text
              textChunk = data.message.content.parts[0];
            } else if (data.choices?.[0]?.delta?.content) {
              // Standard API fallback structure
              textChunk = data.choices[0].delta.content;
            } else if (data.text) {
              textChunk = data.text;
            } else if (data.type === "error" && data.error) {
              console.error("Error en stream Codex:", data.error.message);
            }
            
            if (typeof textChunk === "string") {
                if (textChunk.startsWith(fullContent)) {
                    const diff = textChunk.slice(fullContent.length);
                    fullContent = textChunk;
                    if (diff) onChunk(diff);
                } else {
                    fullContent += textChunk;
                    onChunk(textChunk);
                }
            }
          } catch (e) {
            // Ignore individual chunk JSON parsing errors
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      content: fullContent,
      inputTokens,
      outputTokens,
      model,
      provider: this.id,
    };
  }

  async healthCheck(): Promise<boolean> {
    return !!this.accessToken;
  }

  async listModels(): Promise<string[]> {
    return ["gpt-5.4-mini", "gpt-5.4", "gpt-5.3-codex-spark", "gpt-5.5"];
  }
}
