/**
 * Auth Manager — Orchestrates all authentication flows.
 * Priority: Ambient env vars → OAuth (Copilot/OpenAI) → API Key
 */

import { getDb } from "../db/client.js";
import { deleteCredentials, loadCredentials, saveCredentials } from "./keystore.js";
import { githubCopilotOAuthProvider } from "./oauth/github-copilot.js";
import { openaiCodexOAuthProvider } from "./oauth/openai-codex.js";
import type { OAuthCredentials, OAuthLoginCallbacks, OAuthProviderInterface } from "./oauth/types.js";
import { getEnvApiKey } from "./env-keys.js";

export type AuthMethod = "env" | "oauth" | "apikey" | "local";

export interface ProviderConfig {
  id: string;
  method: AuthMethod;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

const OAUTH_PROVIDERS: Record<string, OAuthProviderInterface> = {
  "openai-codex": openaiCodexOAuthProvider,
  "github-copilot": githubCopilotOAuthProvider,
};

// ─── Config persistence ────────────────────────────────────────────────────

export function getConfig(key: string): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setConfig(key: string, value: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO config (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

// ─── Active Provider ───────────────────────────────────────────────────────

export function getActiveProvider(): string {
  return getConfig("active_provider") ?? "ollama";
}

export function setActiveProvider(providerId: string): void {
  setConfig("active_provider", providerId);
}

// ─── API Key Providers ─────────────────────────────────────────────────────

export async function loginWithApiKey(providerId: string, apiKey: string): Promise<void> {
  await saveCredentials(providerId, apiKey);
  setConfig(`provider:${providerId}:method`, "apikey");
  setActiveProvider(providerId);
}

export async function getApiKey(providerId: string): Promise<string | null> {
  // Check env vars first (ambient credentials)
  const envKey = getEnvApiKey(providerId);
  if (envKey) return envKey;

  // Then keychain/encrypted file
  return loadCredentials(providerId);
}

// ─── OAuth Providers ───────────────────────────────────────────────────────

export async function loginWithOAuth(
  providerId: string,
  callbacks: OAuthLoginCallbacks,
): Promise<OAuthCredentials> {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) throw new Error(`No hay proveedor OAuth registrado para: ${providerId}`);

  const credentials = await provider.login(callbacks);
  const serialized = JSON.stringify(credentials);
  await saveCredentials(providerId, serialized);
  setConfig(`provider:${providerId}:method`, "oauth");
  setActiveProvider(providerId);
  return credentials;
}

export async function getOAuthCredentials(providerId: string): Promise<OAuthCredentials | null> {
  const raw = await loadCredentials(providerId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthCredentials;
  } catch {
    return null;
  }
}

export async function refreshOAuthToken(providerId: string): Promise<OAuthCredentials | null> {
  const provider = OAUTH_PROVIDERS[providerId];
  if (!provider) return null;

  const current = await getOAuthCredentials(providerId);
  if (!current) return null;

  if (current.expires > Date.now() + 60_000) return current; // Still valid

  try {
    const refreshed = await provider.refreshToken(current);
    await saveCredentials(providerId, JSON.stringify(refreshed));
    return refreshed;
  } catch {
    return null;
  }
}

// ─── Ollama / Custom endpoints ─────────────────────────────────────────────

export function loginOllama(baseUrl = "http://localhost:11434"): void {
  setConfig("provider:ollama:base_url", baseUrl);
  setConfig("provider:ollama:method", "local");
  setActiveProvider("ollama");
}

export function loginCustomEndpoint(baseUrl: string, model?: string): void {
  setConfig("provider:custom:base_url", baseUrl);
  if (model) setConfig("provider:custom:model", model);
  setConfig("provider:custom:method", "local");
  setActiveProvider("custom");
}

export function getCustomEndpointConfig(): { baseUrl: string; model?: string } | null {
  const baseUrl = getConfig("provider:custom:base_url");
  if (!baseUrl) return null;
  const model = getConfig("provider:custom:model") ?? undefined;
  return { baseUrl, model };
}

export function getOllamaConfig(): { baseUrl: string } {
  const baseUrl = getConfig("provider:ollama:base_url") ?? "http://localhost:11434";
  return { baseUrl };
}

// ─── Logout ────────────────────────────────────────────────────────────────

export async function logout(providerId: string): Promise<void> {
  await deleteCredentials(providerId);
  const db = getDb();
  db.prepare("DELETE FROM config WHERE key LIKE ?").run(`provider:${providerId}:%`);
  if (getActiveProvider() === providerId) {
    setActiveProvider("ollama");
  }
}

// ─── Status ────────────────────────────────────────────────────────────────

export interface ProviderStatus {
  id: string;
  name: string;
  connected: boolean;
  method?: AuthMethod;
  source?: string;
}

export async function getAllProviderStatuses(): Promise<ProviderStatus[]> {
  const { getAmbientCredentials } = await import("./env-keys.js");
  const ambients = getAmbientCredentials();
  const ambientMap = new Map(ambients.map((a) => [a.provider, a.source]));

  const providers = [
    { id: "openai-codex", name: "ChatGPT Plus/Pro (Codex)" },
    { id: "github-copilot", name: "GitHub Copilot" },
    { id: "anthropic", name: "Anthropic (Claude)" },
    { id: "openai", name: "OpenAI (API Key)" },
    { id: "google", name: "Google Gemini" },
    { id: "groq", name: "Groq" },
    { id: "deepseek", name: "DeepSeek" },
    { id: "ollama", name: "Ollama (local)" },
    { id: "custom", name: "Custom Endpoint" },
  ];

  const statuses: ProviderStatus[] = [];
  for (const p of providers) {
    if (ambientMap.has(p.id)) {
      statuses.push({ id: p.id, name: p.name, connected: true, method: "env", source: ambientMap.get(p.id) });
      continue;
    }
    const creds = await loadCredentials(p.id);
    statuses.push({
      id: p.id,
      name: p.name,
      connected: !!creds,
      method: creds ? (getConfig(`provider:${p.id}:method`) as AuthMethod) ?? "apikey" : undefined,
    });
  }
  return statuses;
}
