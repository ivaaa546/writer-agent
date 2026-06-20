/**
 * `writer chat` — Interactive conversation with memory.
 */

import { randomUUID } from "node:crypto";
import * as readline from "node:readline";
import chalk from "chalk";
import { getDb } from "../db/client.js";
import { buildContext } from "../context/builder.js";
import { getProvider } from "../providers/router.js";

function getActiveProjectId(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = 'active_project_id'").get() as { value: string } | undefined;
  if (!row?.value) {
    console.error(chalk.red("No hay proyecto activo. Ejecuta: writer init"));
    process.exit(1);
  }
  return row.value;
}

function saveMessage(conversationId: string, role: "user" | "assistant", content: string, provider: string, model: string, tokens = 0): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO messages (id, conversation_id, role, content, provider, model, tokens_used)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), conversationId, role, content, provider, model, tokens);
}

function recordTokenUsage(projectId: string, provider: string, model: string, inputTokens: number, outputTokens: number): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO token_usage (id, project_id, provider, model, input_tokens, output_tokens)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(randomUUID(), projectId, provider, model, inputTokens, outputTokens);
}

export async function chatCommand(opts: { context?: string } = {}): Promise<void> {
  const db = getDb();
  const projectId = getActiveProjectId();

  // Get project name for display
  const project = db.prepare("SELECT name FROM projects WHERE id = ?").get(projectId) as { name: string } | undefined;
  const projectName = project?.name ?? "default";

  // Create a new conversation
  const conversationId = randomUUID();
  const title = `Chat ${new Date().toLocaleString("es")}`;
  db.prepare("INSERT INTO conversations (id, project_id, title) VALUES (?, ?, ?)").run(conversationId, projectId, title);

  console.log(chalk.bold.magenta(`\n✦ Writer Agent — Chat [${projectName}]`));
  console.log(chalk.gray("  Escribe tu mensaje. 'exit' o Ctrl+C para salir.\n"));

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  const askQuestion = (prompt: string): Promise<string> =>
    new Promise((resolve) => rl.question(prompt, resolve));

  // Handle Ctrl+C gracefully
  rl.on("SIGINT", () => {
    console.log(chalk.gray("\n\n  Conversación guardada. ¡Hasta luego!\n"));
    rl.close();
    process.exit(0);
  });

  while (true) {
    const userInput = await askQuestion(chalk.cyan("Tú: "));

    if (userInput.toLowerCase() === "exit" || userInput.toLowerCase() === "salir") {
      console.log(chalk.gray("\n  Conversación guardada. ¡Hasta luego!\n"));
      break;
    }

    if (!userInput.trim()) continue;

    // Save user message
    saveMessage(conversationId, "user", userInput, "", "", 0);

    // Build context
    const messages = await buildContext({
      conversationId,
      projectId,
      userQuery: userInput,
      includeDocumentChunks: !!opts.context,
    });

    // Get provider and stream response
    try {
      const { provider, model } = await getProvider();
      process.stdout.write(chalk.bold.white("\nWriter Agent: "));

      let fullResponse = "";
      const result = await provider.stream(messages, (chunk) => {
        process.stdout.write(chalk.white(chunk));
        fullResponse += chunk;
      }, { model });

      process.stdout.write("\n\n");

      // Save assistant message and usage
      saveMessage(conversationId, "assistant", fullResponse, provider.id, model, result.outputTokens);
      recordTokenUsage(projectId, provider.id, model, result.inputTokens, result.outputTokens);

      // Update conversation timestamp
      db.prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId);

    } catch (err) {
      console.error(chalk.red("\n✗ Error al obtener respuesta:"), err instanceof Error ? err.message : err);
      console.log(chalk.gray("  Verifica tu configuración con: writer status\n"));
    }
  }

  rl.close();
}

export function chatListCommand(): void {
  const db = getDb();
  const projectId = getActiveProjectId();

  const conversations = db.prepare(`
    SELECT id, title, created_at, updated_at,
      (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) as message_count
    FROM conversations WHERE project_id = ?
    ORDER BY updated_at DESC
  `).all(projectId) as { id: string; title: string; created_at: string; updated_at: string; message_count: number }[];

  console.log(chalk.bold("\n✦ Conversaciones\n"));
  if (conversations.length === 0) {
    console.log(chalk.gray("  No hay conversaciones aún. Ejecuta: writer chat\n"));
    return;
  }

  for (const c of conversations) {
    console.log(`  ${chalk.cyan(c.id.slice(0, 8))} ${chalk.white(c.title)}`);
    console.log(chalk.gray(`     ${c.message_count} mensajes · ${c.updated_at}`));
  }
  console.log();
}

export function chatDeleteCommand(id: string): void {
  const db = getDb();
  const conv = db.prepare("SELECT id FROM conversations WHERE id LIKE ?").get(`${id}%`) as { id: string } | undefined;
  if (!conv) {
    console.error(chalk.red(`✗ Conversación no encontrada: ${id}`));
    process.exit(1);
  }
  db.prepare("DELETE FROM conversations WHERE id = ?").run(conv.id);
  console.log(chalk.green(`✓ Conversación ${id} eliminada`));
}
