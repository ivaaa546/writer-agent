/**
 * GitHub Copilot provider — uses the OAuth token from github-copilot auth
 * and connects to the Copilot API (OpenAI-compatible).
 */

import { getGitHubCopilotBaseUrl, refreshGitHubCopilotToken } from "../auth/oauth/github-copilot.js";
import { loadCredentials, saveCredentials } from "../auth/keystore.js";
import type { OAuthCredentials } from "../auth/oauth/types.js";
import { OpenAIProvider } from "./openai.js";
import type { AIProvider, CompletionOptions, CompletionResult, Message, StreamCallback } from "./base.js";

export class GitHubCopilotProvider implements AIProvider {
  id = "github-copilot";
  name = "GitHub Copilot";

  private credentials: OAuthCredentials | null = null;

  private async getAccessToken(): Promise<string> {
    // Load from keystore
    if (!this.credentials) {
      const raw = await loadCredentials("github-copilot");
      if (!raw) throw new Error("No hay credenciales de GitHub Copilot. Ejecuta: writer login copilot");
      this.credentials = JSON.parse(raw) as OAuthCredentials;
    }

    // Refresh if expired
    if (this.credentials.expires < Date.now() + 60_000) {
      const refreshed = await refreshGitHubCopilotToken(this.credentials.refresh);
      this.credentials = refreshed;
      await saveCredentials("github-copilot", JSON.stringify(refreshed));
    }

    return this.credentials.access;
  }

  private async buildDelegate(): Promise<OpenAIProvider> {
    const token = await this.getAccessToken();
    const baseUrl = getGitHubCopilotBaseUrl(token);
    return new OpenAIProvider({
      apiKey: token,
      baseUrl: `${baseUrl}/chat/completions`,
      providerId: "github-copilot",
      providerName: "GitHub Copilot",
      lightModel: "gpt-4o-mini",
      heavyModel: "gpt-4o",
    });
  }

  async complete(messages: Message[], options?: CompletionOptions): Promise<CompletionResult> {
    const delegate = await this.buildDelegate();
    return delegate.complete(messages, options);
  }

  async stream(messages: Message[], onChunk: StreamCallback, options?: CompletionOptions): Promise<CompletionResult> {
    const delegate = await this.buildDelegate();
    return delegate.stream(messages, onChunk, options);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.getAccessToken();
      return true;
    } catch {
      return false;
    }
  }

  async listModels(): Promise<string[]> {
    return ["gpt-4o-mini", "gpt-4o", "claude-3.5-sonnet", "claude-3-haiku"];
  }
}
