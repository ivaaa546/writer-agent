/**
 * Text chunker — splits text into token-sized chunks using tiktoken.
 * Respects paragraph/sentence boundaries when possible.
 */

import { createHash } from "node:crypto";

const CHUNK_SIZE_TOKENS = 2000;
const OVERLAP_CHARS = 200; // Character overlap between chunks for continuity

interface Chunk {
  index: number;
  content: string;
  tokenCount: number;
}

/**
 * Estimates token count (roughly 4 chars per token).
 * Used as fallback if tiktoken is unavailable.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Splits text into paragraph-aware chunks targeting CHUNK_SIZE_TOKENS per chunk.
 * Falls back to character-based splitting if tiktoken is unavailable.
 */
export async function chunkText(text: string): Promise<Chunk[]> {
  let encode: ((text: string) => number[]) | null = null;

  try {
    const { encoding_for_model } = await import("tiktoken");
    const enc = encoding_for_model("gpt-4o");
    encode = (t: string) => Array.from(enc.encode(t));
  } catch {
    // tiktoken unavailable, use estimate
    encode = null;
  }

  const countTokens = (t: string): number => {
    if (encode) return encode(t).length;
    return estimateTokens(t);
  };

  // Split by double newlines (paragraphs) first
  const paragraphs = text.split(/\n{2,}/);
  const chunks: Chunk[] = [];
  let current = "";
  let currentTokens = 0;
  let index = 0;

  for (const para of paragraphs) {
    const paraTokens = countTokens(para);

    // If a single paragraph exceeds chunk size, split by sentences
    if (paraTokens > CHUNK_SIZE_TOKENS) {
      if (current.trim()) {
        chunks.push({ index: index++, content: current.trim(), tokenCount: currentTokens });
        current = current.slice(-OVERLAP_CHARS); // Keep overlap
        currentTokens = countTokens(current);
      }

      const sentences = para.split(/(?<=[.!?])\s+/);
      for (const sentence of sentences) {
        const sentTokens = countTokens(sentence);
        if (currentTokens + sentTokens > CHUNK_SIZE_TOKENS && current.trim()) {
          chunks.push({ index: index++, content: current.trim(), tokenCount: currentTokens });
          current = current.slice(-OVERLAP_CHARS) + " " + sentence;
          currentTokens = countTokens(current);
        } else {
          current += (current ? " " : "") + sentence;
          currentTokens += sentTokens;
        }
      }
      continue;
    }

    if (currentTokens + paraTokens > CHUNK_SIZE_TOKENS && current.trim()) {
      chunks.push({ index: index++, content: current.trim(), tokenCount: currentTokens });
      current = current.slice(-OVERLAP_CHARS) + "\n\n" + para;
      currentTokens = countTokens(current);
    } else {
      current += (current ? "\n\n" : "") + para;
      currentTokens += paraTokens;
    }
  }

  if (current.trim()) {
    chunks.push({ index: index, content: current.trim(), tokenCount: currentTokens });
  }

  return chunks;
}

/**
 * SHA-256 hash of file content for cache invalidation.
 */
export function hashContent(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Simple TF-IDF-based relevance search over chunks.
 * Returns chunk indices sorted by relevance to the query.
 */
export function findRelevantChunks(
  query: string,
  chunks: { content: string }[],
  topK = 3,
): number[] {
  const queryTerms = new Set(
    query.toLowerCase().split(/\s+/).filter((w) => w.length > 3),
  );

  const scores = chunks.map((chunk, idx) => {
    const chunkTerms = chunk.content.toLowerCase().split(/\s+/);
    let score = 0;
    for (const term of queryTerms) {
      const count = chunkTerms.filter((t) => t.includes(term)).length;
      score += count;
    }
    return { idx, score };
  });

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((s) => s.idx);
}
