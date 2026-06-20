/**
 * Base AIProvider interface — all providers implement this.
 */

export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface CompletionOptions {
  model?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface CompletionResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  provider: string;
}

export type StreamCallback = (chunk: string) => void;

export interface AIProvider {
  id: string;
  name: string;

  /** Single-shot completion */
  complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult>;

  /** Streaming completion — calls onChunk for each token chunk */
  stream(messages: Message[], onChunk: StreamCallback, options?: CompletionOptions): Promise<CompletionResult>;

  /** Check if provider is reachable/configured */
  healthCheck(): Promise<boolean>;

  /** Returns available model IDs */
  listModels(): Promise<string[]>;
}

export type ModelTier = "light" | "heavy";

export interface ModelConfig {
  light: string;
  heavy: string;
}
