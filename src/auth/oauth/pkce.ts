import { createHash, randomBytes } from "node:crypto";

/**
 * Generates a PKCE (Proof Key for Code Exchange) pair.
 * verifier: random base64url string
 * challenge: SHA-256 of verifier, base64url encoded
 */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomBytes(32).toString("base64url");
  const hash = createHash("sha256").update(verifier).digest();
  const challenge = Buffer.from(hash).toString("base64url");
  return { verifier, challenge };
}
