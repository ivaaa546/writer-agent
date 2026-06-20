/**
 * Custom OpenAI-compatible endpoint provider.
 * Works with LM Studio, llama.cpp, vLLM, Text Generation WebUI, etc.
 */

import { OllamaProvider } from "./ollama.js";

export class CustomEndpointProvider extends OllamaProvider {
  constructor(opts: { baseUrl: string; model?: string }) {
    super({
      baseUrl: opts.baseUrl,
      model: opts.model ?? "local-model",
      providerId: "custom",
      providerName: `Custom (${opts.baseUrl})`,
    });
  }
}
