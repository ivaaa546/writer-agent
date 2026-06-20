/**
 * GitHub Copilot OAuth flow (Device Code)
 * Emulates the VS Code Copilot Chat extension to authenticate via GitHub.
 */

import { pollOAuthDeviceCodeFlow } from "./device-code.js";
import type { OAuthCredentials, OAuthDeviceCodeInfo, OAuthLoginCallbacks, OAuthProviderInterface } from "./types.js";

type CopilotCredentials = OAuthCredentials & {
  enterpriseUrl?: string;
};

const CLIENT_ID = Buffer.from("SXYxLmI1MDdhMDhjODdlY2ZlOTg=", "base64").toString("utf-8");

const COPILOT_HEADERS = {
  "User-Agent": "GitHubCopilotChat/0.35.0",
  "Editor-Version": "vscode/1.107.0",
  "Editor-Plugin-Version": "copilot-chat/0.35.0",
  "Copilot-Integration-Id": "vscode-chat",
} as const;

export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`https://${trimmed}`);
    return url.hostname;
  } catch {
    return null;
  }
}

function getUrls(domain: string) {
  return {
    deviceCodeUrl: `https://${domain}/login/device/code`,
    accessTokenUrl: `https://${domain}/login/oauth/access_token`,
    copilotTokenUrl: `https://api.${domain}/copilot_internal/v2/token`,
  };
}

function getBaseUrlFromToken(token: string): string | null {
  const match = token.match(/proxy-ep=([^;]+)/);
  if (!match) return null;
  const proxyHost = match[1]!;
  const apiHost = proxyHost.replace(/^proxy\./, "api.");
  return `https://${apiHost}`;
}

export function getGitHubCopilotBaseUrl(token?: string, enterpriseDomain?: string): string {
  if (token) {
    const urlFromToken = getBaseUrlFromToken(token);
    if (urlFromToken) return urlFromToken;
  }
  if (enterpriseDomain) return `https://copilot-api.${enterpriseDomain}`;
  return "https://api.individual.githubcopilot.com";
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return response.json();
}

async function startDeviceFlow(domain: string) {
  const urls = getUrls(domain);
  const data = await fetchJson(urls.deviceCodeUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "GitHubCopilotChat/0.35.0",
    },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: "read:user" }),
  }) as Record<string, unknown>;

  const intervalRaw = data["interval"];
  const interval = typeof intervalRaw === "number" ? intervalRaw : undefined;

  if (
    typeof data["device_code"] !== "string" ||
    typeof data["user_code"] !== "string" ||
    typeof data["verification_uri"] !== "string" ||
    typeof data["expires_in"] !== "number"
  ) {
    throw new Error("Invalid device code response fields");
  }

  let parsedUri: URL;
  try {
    parsedUri = new URL(data["verification_uri"] as string);
  } catch {
    throw new Error("Untrusted verification_uri in device code response");
  }
  if (parsedUri.protocol !== "https:" && parsedUri.protocol !== "http:") {
    throw new Error("Untrusted verification_uri in device code response");
  }

  return {
    device_code: data["device_code"] as string,
    user_code: data["user_code"] as string,
    verification_uri: parsedUri.href,
    interval,
    expires_in: data["expires_in"] as number,
  };
}

async function pollForGitHubAccessToken(
  domain: string,
  device: Awaited<ReturnType<typeof startDeviceFlow>>,
  signal?: AbortSignal,
): Promise<string> {
  const urls = getUrls(domain);
  return pollOAuthDeviceCodeFlow<string>({
    intervalSeconds: device.interval,
    expiresInSeconds: device.expires_in,
    signal,
    poll: async () => {
      const raw = await fetchJson(urls.accessTokenUrl, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "GitHubCopilotChat/0.35.0",
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      }) as Record<string, unknown>;

      if (typeof raw["access_token"] === "string") {
        return { status: "complete", value: raw["access_token"] };
      }
      const error = raw["error"] as string | undefined;
      if (error === "authorization_pending") return { status: "pending" };
      if (error === "slow_down") return { status: "slow_down" };
      return { status: "failed", message: `Device flow failed: ${error ?? "unknown"}` };
    },
  });
}

export async function refreshGitHubCopilotToken(
  refreshToken: string,
  enterpriseDomain?: string,
): Promise<OAuthCredentials> {
  const domain = enterpriseDomain || "github.com";
  const urls = getUrls(domain);

  const raw = await fetchJson(urls.copilotTokenUrl, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${refreshToken}`,
      ...COPILOT_HEADERS,
    },
  }) as Record<string, unknown>;

  const token = raw["token"];
  const expiresAt = raw["expires_at"];

  if (typeof token !== "string" || typeof expiresAt !== "number") {
    throw new Error("Invalid Copilot token response fields");
  }

  return {
    refresh: refreshToken,
    access: token,
    expires: expiresAt * 1000 - 5 * 60 * 1000,
    enterpriseUrl: enterpriseDomain,
  };
}

export async function loginGitHubCopilot(options: {
  onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
  onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) => Promise<string>;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}): Promise<OAuthCredentials> {
  const input = await options.onPrompt({
    message: "GitHub Enterprise URL/domain (deja vacío para github.com)",
    placeholder: "company.ghe.com",
    allowEmpty: true,
  });

  if (options.signal?.aborted) throw new Error("Login cancelado");

  const trimmed = input.trim();
  const enterpriseDomain = normalizeDomain(input);
  if (trimmed && !enterpriseDomain) throw new Error("URL/dominio de GitHub Enterprise inválido");
  const domain = enterpriseDomain || "github.com";

  const device = await startDeviceFlow(domain);
  options.onDeviceCode({
    userCode: device.user_code,
    verificationUri: device.verification_uri,
    intervalSeconds: device.interval,
    expiresInSeconds: device.expires_in,
  });

  const githubAccessToken = await pollForGitHubAccessToken(domain, device, options.signal);
  const credentials = await refreshGitHubCopilotToken(githubAccessToken, enterpriseDomain ?? undefined);

  options.onProgress?.("Habilitando modelos...");
  return credentials;
}

export const githubCopilotOAuthProvider: OAuthProviderInterface = {
  id: "github-copilot",
  name: "GitHub Copilot",

  async login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
    return loginGitHubCopilot({
      onDeviceCode: callbacks.onDeviceCode,
      onPrompt: callbacks.onPrompt,
      onProgress: callbacks.onProgress,
      signal: callbacks.signal,
    });
  },

  async refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
    const creds = credentials as CopilotCredentials;
    return refreshGitHubCopilotToken(creds.refresh, creds.enterpriseUrl);
  },

  getApiKey(credentials: OAuthCredentials): string {
    return credentials.access;
  },
};
