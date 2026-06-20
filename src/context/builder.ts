/**
 * Context Builder — assembles the optimal context for each AI call.
 * Priority (anti-token strategy):
 * 1. System prompt (~500 tokens)
 * 2. Last 3-5 messages
 * 3. Compressed summary of older messages
 * 4. Relevant document chunks (TF-IDF search)
 * 5. Project memory
 */

import type { Message } from "../providers/base.js";
import { findRelevantChunks } from "../chunker.js";
import { getDb } from "../db/client.js";

const MAX_RECENT_MESSAGES = 5;
const MAX_CHUNK_TOKENS = 3000;

interface ContextBuilderOptions {
  conversationId: string;
  projectId: string;
  userQuery: string;
  systemPrompt?: string;
  includeDocumentChunks?: boolean;
}

export async function buildContext(opts: ContextBuilderOptions): Promise<Message[]> {
  const db = getDb();
  const messages: Message[] = [];

  // 1. System prompt
  const systemParts: string[] = [];

  if (opts.systemPrompt) {
    systemParts.push(opts.systemPrompt);
  } else {
    systemParts.push("Eres Writer Agent, un asistente experto en redacción, análisis y gestión documental. Responde siempre de forma clara, precisa y en el idioma del usuario.");
  }

  // 5. Project memory
  const projectMemories = db.prepare(`
    SELECT key, value FROM memories
    WHERE (scope = 'project' AND project_id = ?) OR scope = 'global'
    ORDER BY updated_at DESC LIMIT 10
  `).all(opts.projectId) as { key: string; value: string }[];

  if (projectMemories.length > 0) {
    const memoryText = projectMemories.map((m) => `${m.key}: ${m.value}`).join("\n");
    systemParts.push(`\n## Contexto del proyecto:\n${memoryText}`);
  }

  messages.push({ role: "system", content: systemParts.join("\n") });

  // 3. Summary of older messages (if conversation is long)
  const latestSummary = db.prepare(`
    SELECT summary FROM conversation_summaries
    WHERE conversation_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(opts.conversationId) as { summary: string } | undefined;

  if (latestSummary) {
    messages.push({
      role: "system",
      content: `## Resumen de la conversación anterior:\n${latestSummary.summary}`,
    });
  }

  // 4. Relevant document chunks
  if (opts.includeDocumentChunks) {
    const allChunks = db.prepare(`
      SELECT c.content FROM chunks c
      JOIN documents d ON d.id = c.document_id
      WHERE d.project_id = ?
      ORDER BY c.chunk_index
    `).all(opts.projectId) as { content: string }[];

    if (allChunks.length > 0) {
      const relevantIndices = findRelevantChunks(opts.userQuery, allChunks, 3);
      const relevantContent = relevantIndices
        .map((i) => allChunks[i]?.content ?? "")
        .join("\n\n---\n\n");

      if (relevantContent.trim()) {
        messages.push({
          role: "system",
          content: `## Fragmentos relevantes de documentos:\n${relevantContent.slice(0, MAX_CHUNK_TOKENS * 4)}`,
        });
      }
    }
  }

  // 2. Last N messages of the conversation
  const recentMessages = db.prepare(`
    SELECT role, content FROM messages
    WHERE conversation_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(opts.conversationId, MAX_RECENT_MESSAGES) as { role: string; content: string }[];

  // Reverse to get chronological order
  for (const msg of recentMessages.reverse()) {
    messages.push({ role: msg.role as Message["role"], content: msg.content });
  }

  return messages;
}
