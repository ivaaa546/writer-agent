/**
 * Model Router — selects the appropriate model tier (light/heavy) based on task type.
 * Instantiates and returns the active provider with the correct model configured.
 */

import type { AIProvider } from "./base.js";
import type { ModelTier } from "./base.js";
import { OpenAIProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { OllamaProvider } from "./ollama.js";
import { GitHubCopilotProvider } from "./github-copilot.js";
import { OpenAICodexWebProvider } from "./openai-codex-web.js";
import { CustomEndpointProvider } from "./custom.js";
import {
  getActiveProvider,
  getApiKey,
  getOAuthCredentials,
  getOllamaConfig,
  getCustomEndpointConfig,
  getConfig,
} from "../auth/auth-manager.js";

export type TaskType =
  | "grammar"
  | "reformat"
  | "summarize_short"
  | "blog"
  | "rewrite"
  | "analyze_deep"
  | "thesis"
  | "policy"
  | "ocr";

const HEAVY_TASKS: TaskType[] = ["analyze_deep", "thesis", "policy", "ocr"];

export function selectTier(task: TaskType): ModelTier {
  return HEAVY_TASKS.includes(task) ? "heavy" : "light";
}

const MODEL_MAP: Record<string, { light: string; heavy: string }> = {
  openai: { light: "gpt-4o-mini", heavy: "gpt-4o" },
  "openai-codex": { light: "gpt-5.4-mini", heavy: "gpt-5.4" },
  anthropic: { light: "claude-haiku-4-5", heavy: "claude-sonnet-4-6" },
  google: { light: "gemini-1.5-flash", heavy: "gemini-1.5-pro" },
  groq: { light: "llama-3.1-8b-instant", heavy: "llama-3.3-70b-versatile" },
  deepseek: { light: "deepseek-chat", heavy: "deepseek-reasoner" },
  mistral: { light: "mistral-small-latest", heavy: "mistral-large-latest" },
  "github-copilot": { light: "gpt-4o-mini", heavy: "gpt-4o" },
  ollama: { light: "llama3.2", heavy: "llama3.1:70b" },
  custom: { light: "local-model", heavy: "local-model" },
};

export async function getProvider(task?: TaskType, forceModel?: string): Promise<{ provider: AIProvider; model: string }> {
  const activeId = getActiveProvider();
  const tier = task ? selectTier(task) : "light";
  const defaultModels = MODEL_MAP[activeId] ?? { light: "gpt-4o-mini", heavy: "gpt-4o" };
  
  const customLight = getConfig(`provider:${activeId}:model_light`);
  const customHeavy = getConfig(`provider:${activeId}:model_heavy`);
  
  const models = {
    light: customLight || defaultModels.light,
    heavy: customHeavy || defaultModels.heavy,
  };

  const model = forceModel ?? models[tier];

  let provider: AIProvider;

  switch (activeId) {
    case "openai": {
      const apiKey = await getApiKey(activeId);
      if (!apiKey) throw new Error(`No hay API Key para ${activeId}. Ejecuta: writer login openai`);
      provider = new OpenAIProvider({ apiKey, lightModel: models.light, heavyModel: models.heavy });
      break;
    }
    case "openai-codex": {
      // OAuth flow: credentials are stored as JSON with an 'access' JWT
      const creds = await getOAuthCredentials("openai-codex");
      if (!creds?.access) throw new Error("No hay credenciales OAuth para OpenAI. Ejecuta: writer login openai");
      provider = new OpenAICodexWebProvider({
        accessToken: creds.access,
        lightModel: models.light,
        heavyModel: models.heavy,
      });
      break;
    }
    case "anthropic": {
      const apiKey = await getApiKey("anthropic");
      if (!apiKey) throw new Error("No hay API Key para Anthropic. Ejecuta: writer login anthropic");
      provider = new AnthropicProvider(apiKey);
      break;
    }
    case "github-copilot": {
      provider = new GitHubCopilotProvider();
      break;
    }
    case "ollama": {
      const { baseUrl } = getOllamaConfig();
      provider = new OllamaProvider({ baseUrl, model });
      break;
    }
    case "custom": {
      const config = getCustomEndpointConfig();
      if (!config) throw new Error("No hay endpoint personalizado configurado. Ejecuta: writer login custom");
      provider = new CustomEndpointProvider({ baseUrl: config.baseUrl, model: config.model });
      break;
    }
    default: {
      // Fallback: try Ollama
      provider = new OllamaProvider();
    }
  }

  return { provider, model };
}

export async function getProviderById(providerId: string): Promise<AIProvider> {
  const { provider } = await getProvider();
  return provider;
}
