// OAuth shared types used across all providers

export interface OAuthCredentials {
  access: string;
  refresh: string;
  expires: number; // Unix ms
  accountId?: string;
  [key: string]: unknown;
}

export interface OAuthDeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  intervalSeconds?: number;
  expiresInSeconds?: number;
}

export interface OAuthPrompt {
  message: string;
  placeholder?: string;
  allowEmpty?: boolean;
}

export interface OAuthLoginCallbacks {
  onAuth: (info: { url: string; instructions?: string }) => void;
  onDeviceCode: (info: OAuthDeviceCodeInfo) => void;
  onPrompt: (prompt: OAuthPrompt) => Promise<string>;
  onProgress?: (message: string) => void;
  onManualCodeInput?: () => Promise<string>;
  onSelect?: (opts: { message: string; options: { id: string; label: string }[] }) => Promise<string | null>;
  signal?: AbortSignal;
}

export interface OAuthProviderInterface {
  id: string;
  name: string;
  usesCallbackServer?: boolean;
  login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials>;
  refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials>;
  getApiKey(credentials: OAuthCredentials): string;
}
