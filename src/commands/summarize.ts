/**
 * `writer summarize <file>` — Summarizes a document using the active AI provider.
 */

import { randomUUID } from "node:crypto";
import { statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import chalk from "chalk";
import ora from "ora";
import { getDb } from "../db/client.js";
import { parseDocument } from "../readers/index.js";
import { chunkText, hashContent, findRelevantChunks } from "../chunker.js";
import { getProvider } from "../providers/router.js";
import type { Message } from "../providers/base.js";

function getActiveProjectId(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = 'active_project_id'").get() as { value: string } | undefined;
  if (!row?.value) {
    console.error(chalk.red("No hay proyecto activo. Ejecuta: writer init"));
    process.exit(1);
  }
  return row.value;
}

export async function summarizeCommand(filePath: string, opts: { output?: string } = {}): Promise<void> {
  const db = getDb();
  const projectId = getActiveProjectId();

  const spinner = ora(`Leyendo ${basename(filePath)}...`).start();

  try {
    // Parse document
    const parsed = await parseDocument(filePath);
    const fileStats = statSync(filePath);
    const hash = hashContent(parsed.text);

    // Check cache
    const cached = db.prepare("SELECT id, summary FROM documents WHERE hash = ? AND project_id = ?").get(hash, projectId) as
      | { id: string; summary: string | null }
      | undefined;

    if (cached?.summary) {
      spinner.succeed("Resumen obtenido del caché");
      console.log(chalk.bold("\n📄 Resumen:\n"));
      console.log(cached.summary);
      if (opts.output) {
        writeFileSync(opts.output, cached.summary);
        console.log(chalk.green(`\n✓ Guardado en: ${opts.output}`));
      }
      return;
    }

    // Chunk the document
    spinner.text = "Dividiendo en fragmentos...";
    const chunks = await chunkText(parsed.text);

    // Save document to DB
    const docId = cached?.id ?? randomUUID();
    db.prepare(`
      INSERT OR REPLACE INTO documents (id, project_id, title, path, hash, size_bytes, format)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(docId, projectId, basename(filePath), filePath, hash, fileStats.size, filePath.split(".").pop());

    // Save chunks to DB
    const insertChunk = db.prepare("INSERT OR IGNORE INTO chunks (id, document_id, chunk_index, content, token_count) VALUES (?, ?, ?, ?, ?)");
    const insertFts = db.prepare("INSERT INTO chunks_fts (content, document_id) VALUES (?, ?)");

    for (const chunk of chunks) {
      const chunkId = randomUUID();
      insertChunk.run(chunkId, docId, chunk.index, chunk.content, chunk.tokenCount);
      try { insertFts.run(chunk.content, docId); } catch { /* FTS may already have it */ }
    }

    // Select most representative chunks for summarization
    const { provider, model } = await getProvider("summarize_short");
    spinner.text = `Generando resumen con ${provider.name}...`;

    // For long docs, summarize in chunks then combine
    let summary: string;
    if (chunks.length <= 3) {
      const messages: Message[] = [
        {
          role: "system",
          content: "Eres un asistente experto en análisis documental. Resume el siguiente documento de forma clara y concisa, manteniendo los puntos clave.",
        },
        { role: "user", content: `Por favor resume el siguiente documento:\n\n${parsed.text.slice(0, 12000)}` },
      ];
      const result = await provider.complete(messages, { model });
      summary = result.content;
    } else {
      // Summarize top chunks and combine
      const relevantIndices = findRelevantChunks("resumen contenido principal puntos clave", chunks, Math.min(5, chunks.length));
      const relevantText = relevantIndices.map((i) => chunks[i]?.content ?? "").join("\n\n---\n\n");

      const messages: Message[] = [
        {
          role: "system",
          content: "Eres un asistente experto en análisis documental. Resume los siguientes fragmentos del documento de forma clara y cohesiva.",
        },
        { role: "user", content: `Fragmentos del documento "${basename(filePath)}":\n\n${relevantText}` },
      ];
      const result = await provider.complete(messages, { model });
      summary = result.content;
    }

    // Save summary back to document
    db.prepare("UPDATE documents SET summary = ?, provider_used = ?, updated_at = datetime('now') WHERE id = ?").run(
      summary,
      provider.id,
      docId,
    );

    spinner.succeed("Resumen generado");
    console.log(chalk.bold("\n📄 Resumen:\n"));
    console.log(summary);

    if (opts.output) {
      writeFileSync(opts.output, summary);
      console.log(chalk.green(`\n✓ Guardado en: ${opts.output}`));
    }

    console.log(chalk.gray(`\n  Fragmentos indexados: ${chunks.length} · Modelo: ${model}\n`));
  } catch (err) {
    spinner.fail("Error al procesar documento");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}
