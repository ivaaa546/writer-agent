/**
 * Keystore — stores and retrieves credentials.
 * Priority: OS Keychain (keytar) → Encrypted file fallback (Argon2 + AES-256-GCM)
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { WRITER_DIR } from "../db/client.js";

const CREDS_FILE = join(WRITER_DIR, "credentials.enc");
const PLAIN_CREDS_FILE = join(WRITER_DIR, "credentials.json");
const SERVICE_NAME = "writer-agent";

// Lazy-load keytar to avoid breaking in environments without native modules
let keytarLoaded = false;
let keytar: typeof import("keytar") | null = null;

async function getKeytar(): Promise<typeof import("keytar") | null> {
  if (keytarLoaded) return keytar;
  try {
    keytar = await import("keytar");
    keytarLoaded = true;
    return keytar;
  } catch {
    keytarLoaded = true;
    return null;
  }
}

// ─── Keychain (keytar) ─────────────────────────────────────────────────────

export async function saveToKeychain(provider: string, value: string): Promise<boolean> {
  const kt = await getKeytar();
  if (!kt) return false;
  try {
    await kt.setPassword(SERVICE_NAME, provider, value);
    return true;
  } catch {
    return false;
  }
}

export async function loadFromKeychain(provider: string): Promise<string | null> {
  const kt = await getKeytar();
  if (!kt) return null;
  try {
    return await kt.getPassword(SERVICE_NAME, provider);
  } catch {
    return null;
  }
}

export async function deleteFromKeychain(provider: string): Promise<boolean> {
  const kt = await getKeytar();
  if (!kt) return false;
  try {
    return await kt.deletePassword(SERVICE_NAME, provider);
  } catch {
    return false;
  }
}

// ─── Encrypted File Fallback (AES-256-GCM + Argon2) ──────────────────────

function encryptData(key: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // Format: iv(12) + authTag(16) + ciphertext
  const combined = Buffer.concat([iv, authTag, encrypted]);
  return combined.toString("base64");
}

function decryptData(key: Buffer, encoded: string): string {
  const combined = Buffer.from(encoded, "base64");
  const iv = combined.subarray(0, 12);
  const authTag = combined.subarray(12, 28);
  const ciphertext = combined.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  return decipher.update(ciphertext) + decipher.final("utf8");
}

async function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  // Use dynamic import to avoid issues if argon2 native module is unavailable
  try {
    const argon2 = await import("argon2");
    const hash = await argon2.hash(passphrase, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 1,
      salt,
      raw: true,
      hashLength: 32,
    });
    return Buffer.from(hash);
  } catch {
    // Fallback: PBKDF2 if argon2 is not available
    const { pbkdf2 } = await import("node:crypto");
    return new Promise((resolve, reject) => {
      pbkdf2(passphrase, salt, 310000, 32, "sha256", (err, key) => {
        if (err) reject(err);
        else resolve(key);
      });
    });
  }
}

interface EncryptedStore {
  salt: string; // hex
  entries: Record<string, string>; // provider → encrypted cred
}

function loadStore(): EncryptedStore {
  if (!existsSync(CREDS_FILE)) return { salt: randomBytes(16).toString("hex"), entries: {} };
  try {
    return JSON.parse(readFileSync(CREDS_FILE, "utf-8")) as EncryptedStore;
  } catch {
    return { salt: randomBytes(16).toString("hex"), entries: {} };
  }
}

function saveStore(store: EncryptedStore): void {
  writeFileSync(CREDS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export async function saveToFile(provider: string, value: string, passphrase: string): Promise<void> {
  const store = loadStore();
  const salt = Buffer.from(store.salt, "hex");
  const key = await deriveKey(passphrase, salt);
  store.entries[provider] = encryptData(key, value);
  saveStore(store);
}

export async function loadFromFile(provider: string, passphrase: string): Promise<string | null> {
  const store = loadStore();
  if (!store.entries[provider]) return null;
  const salt = Buffer.from(store.salt, "hex");
  const key = await deriveKey(passphrase, salt);
  try {
    return decryptData(key, store.entries[provider]!);
  } catch {
    return null; // Wrong passphrase or corrupted
  }
}

export async function deleteFromFile(provider: string): Promise<void> {
  const store = loadStore();
  delete store.entries[provider];
  saveStore(store);
}

// ─── Plain JSON fallback (when keytar AND passphrase are unavailable) ────────
// File is protected by OS permissions (0o600). This is the last resort.

function loadPlainStore(): Record<string, string> {
  if (!existsSync(PLAIN_CREDS_FILE)) return {};
  try {
    return JSON.parse(readFileSync(PLAIN_CREDS_FILE, "utf-8")) as Record<string, string>;
  } catch {
    return {};
  }
}

function savePlainStore(store: Record<string, string>): void {
  writeFileSync(PLAIN_CREDS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}

export function saveToPlainFile(provider: string, value: string): void {
  const store = loadPlainStore();
  store[provider] = value;
  savePlainStore(store);
}

export function loadFromPlainFile(provider: string): string | null {
  return loadPlainStore()[provider] ?? null;
}

export function deleteFromPlainFile(provider: string): void {
  const store = loadPlainStore();
  delete store[provider];
  savePlainStore(store);
}

// ─── Unified API ──────────────────────────────────────────────────────────

/**
 * Saves credentials using the best available method:
 * 1. OS Keychain (keytar)
 * 2. AES-256-GCM encrypted file (if passphrase provided)
 * 3. Plain JSON file with chmod 600 (last resort for local CLI use)
 */
export async function saveCredentials(
  provider: string,
  value: string,
  filePassphrase?: string,
): Promise<"keychain" | "file" | "plain"> {
  const keychainOk = await saveToKeychain(provider, value);
  if (keychainOk) return "keychain";

  if (filePassphrase) {
    await saveToFile(provider, value, filePassphrase);
    return "file";
  }

  // Last resort: plain file (chmod 600)
  saveToPlainFile(provider, value);
  return "plain";
}

/**
 * Loads credentials: keychain → encrypted file → plain file.
 */
export async function loadCredentials(provider: string, filePassphrase?: string): Promise<string | null> {
  const fromKeychain = await loadFromKeychain(provider);
  if (fromKeychain) return fromKeychain;

  if (filePassphrase) {
    const fromFile = await loadFromFile(provider, filePassphrase);
    if (fromFile) return fromFile;
  }

  return loadFromPlainFile(provider);
}

/**
 * Removes credentials from keychain and both file stores.
 */
export async function deleteCredentials(provider: string): Promise<void> {
  await deleteFromKeychain(provider);
  await deleteFromFile(provider);
  deleteFromPlainFile(provider);
}
