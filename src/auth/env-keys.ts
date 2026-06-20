/**
 * Resolves API credentials from:
 * 1. Standard environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 * 2. Google Application Default Credentials (ADC)
 * 3. AWS credential sources (profiles, IAM keys, container roles)
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type KnownProvider =
  | "openai"
  | "openai-codex"
  | "anthropic"
  | "google"
  | "google-vertex"
  | "groq"
  | "deepseek"
  | "mistral"
  | "ollama"
  | "github-copilot"
  | "openrouter"
  | "together"
  | "fireworks"
  | "cerebras"
  | "xai"
  | "custom";

const ENV_MAP: Record<string, string[]> = {
  openai: ["OPENAI_API_KEY"],
  anthropic: ["ANTHROPIC_OAUTH_TOKEN", "ANTHROPIC_API_KEY"],
  google: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
  "google-vertex": ["GOOGLE_CLOUD_API_KEY"],
  groq: ["GROQ_API_KEY"],
  deepseek: ["DEEPSEEK_API_KEY"],
  mistral: ["MISTRAL_API_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  together: ["TOGETHER_API_KEY"],
  fireworks: ["FIREWORKS_API_KEY"],
  cerebras: ["CEREBRAS_API_KEY"],
  xai: ["XAI_API_KEY"],
  "github-copilot": ["COPILOT_GITHUB_TOKEN"],
};

/**
 * Returns the first found environment variable value for the given provider.
 */
export function getEnvApiKey(provider: string): string | undefined {
  const envVars = ENV_MAP[provider];
  if (!envVars) return undefined;

  for (const envVar of envVars) {
    const value = process.env[envVar];
    if (value) return value;
  }
  return undefined;
}

/**
 * Returns the list of env var names that are currently set for the given provider.
 */
export function findEnvKeys(provider: string): string[] {
  const envVars = ENV_MAP[provider];
  if (!envVars) return [];
  return envVars.filter((v) => !!process.env[v]);
}

/**
 * Checks if Google Application Default Credentials (ADC) are available.
 * Looks for GOOGLE_APPLICATION_CREDENTIALS env var or the default ADC path.
 */
export function hasGoogleADC(): boolean {
  const explicitPath = process.env["GOOGLE_APPLICATION_CREDENTIALS"];
  if (explicitPath) return existsSync(explicitPath);

  const defaultPath = join(homedir(), ".config", "gcloud", "application_default_credentials.json");
  return existsSync(defaultPath);
}

/**
 * Checks if Google Vertex AI is fully configured (ADC + project + location).
 */
export function isVertexAIConfigured(): boolean {
  const hasCredentials = hasGoogleADC();
  const hasProject = !!(process.env["GOOGLE_CLOUD_PROJECT"] || process.env["GCLOUD_PROJECT"]);
  const hasLocation = !!process.env["GOOGLE_CLOUD_LOCATION"];
  return hasCredentials && hasProject && hasLocation;
}

/**
 * Checks if AWS Bedrock credentials are available via any supported method.
 */
export function hasAWSCredentials(): boolean {
  return !!(
    process.env["AWS_PROFILE"] ||
    (process.env["AWS_ACCESS_KEY_ID"] && process.env["AWS_SECRET_ACCESS_KEY"]) ||
    process.env["AWS_BEARER_TOKEN_BEDROCK"] ||
    process.env["AWS_CONTAINER_CREDENTIALS_RELATIVE_URI"] ||
    process.env["AWS_CONTAINER_CREDENTIALS_FULL_URI"] ||
    process.env["AWS_WEB_IDENTITY_TOKEN_FILE"]
  );
}

/**
 * Returns a summary of all auto-detected credentials for the status command.
 */
export function getAmbientCredentials(): { provider: string; source: string }[] {
  const results: { provider: string; source: string }[] = [];

  for (const [provider, vars] of Object.entries(ENV_MAP)) {
    for (const v of vars) {
      if (process.env[v]) {
        results.push({ provider, source: v });
        break;
      }
    }
  }

  if (isVertexAIConfigured()) {
    results.push({ provider: "google-vertex", source: "Application Default Credentials (ADC)" });
  }

  if (hasAWSCredentials()) {
    results.push({ provider: "amazon-bedrock", source: "AWS Credentials" });
  }

  return results;
}
