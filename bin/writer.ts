#!/usr/bin/env node
/**
 * Writer Agent CLI — Entry point
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Read version from package.json
let version = "0.1.0";
try {
  const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8")) as { version: string };
  version = pkg.version;
} catch { /* ignore */ }

const program = new Command();

program
  .name("writer")
  .description("✦ Writer Agent — Asistente de IA local para redacción y gestión documental")
  .version(version);

// ─── Init ──────────────────────────────────────────────────────────────────
program
  .command("init")
  .description("Setup interactivo — crea workspace y proyecto por defecto")
  .action(async () => {
    const { initCommand } = await import("../src/commands/init.js");
    await initCommand();
  });

// ─── Login ─────────────────────────────────────────────────────────────────
program
  .command("login <provider>")
  .description("Conectar un proveedor de IA (copilot, openai, anthropic, google, ollama, custom...)")
  .action(async (provider: string) => {
    const { loginCommand } = await import("../src/commands/login.js");
    await loginCommand(provider);
  });

program
  .command("logout <provider>")
  .description("Desconectar un proveedor")
  .action(async (provider: string) => {
    const { logoutCommand } = await import("../src/commands/login.js");
    await logoutCommand(provider);
  });

program
  .command("status")
  .description("Ver proveedores conectados y uso de tokens")
  .action(async () => {
    const { statusCommand } = await import("../src/commands/login.js");
    await statusCommand();
  });

program
  .command("model")
  .description("Configurar los modelos usados por el proveedor activo")
  .action(async () => {
    const { modelCommand } = await import("../src/commands/model.js");
    await modelCommand();
  });

// ─── Project ────────────────────────────────────────────────────────────────
const projectCmd = program.command("project").description("Gestión de proyectos");

projectCmd
  .command("create <name>")
  .description("Crear un nuevo proyecto")
  .action(async (name: string) => {
    const { projectCreateCommand } = await import("../src/commands/project.js");
    await projectCreateCommand(name);
  });

projectCmd
  .command("list")
  .description("Listar todos los proyectos")
  .action(async () => {
    const { projectListCommand } = await import("../src/commands/project.js");
    projectListCommand();
  });

projectCmd
  .command("switch <name>")
  .description("Cambiar al proyecto especificado")
  .action(async (name: string) => {
    const { projectSwitchCommand } = await import("../src/commands/project.js");
    projectSwitchCommand(name);
  });

projectCmd
  .command("info")
  .description("Información del proyecto activo")
  .action(async () => {
    const { projectInfoCommand } = await import("../src/commands/project.js");
    projectInfoCommand();
  });

// ─── Chat ──────────────────────────────────────────────────────────────────
const chatCmd = program.command("chat", { isDefault: true }).description("Conversación con IA");

chatCmd
  .option("--context <file>", "Archivo de contexto (PDF, DOCX, etc.)")
  .action(async (opts: { context?: string }) => {
    const { chatCommand } = await import("../src/commands/chat.js");
    await chatCommand(opts);
  });

chatCmd
  .command("list")
  .description("Listar conversaciones del proyecto activo")
  .action(async () => {
    const { chatListCommand } = await import("../src/commands/chat.js");
    chatListCommand();
  });

chatCmd
  .command("delete <id>")
  .description("Eliminar una conversación")
  .action(async (id: string) => {
    const { chatDeleteCommand } = await import("../src/commands/chat.js");
    chatDeleteCommand(id);
  });

// ─── Write ─────────────────────────────────────────────────────────────────
program
  .command("write <prompt>")
  .description("Redactar contenido con IA")
  .option("-o, --output <file>", "Guardar resultado en archivo")
  .option("--tone <tone>", "Tono (formal, informal, técnico, creativo)", "profesional")
  .option("--format <format>", "Formato de salida (md, docx)", "md")
  .action(async (prompt: string, opts: { output?: string; tone?: string; format?: string }) => {
    const { writeCommand } = await import("../src/commands/write.js");
    await writeCommand(prompt, opts);
  });

program
  .command("blog <title>")
  .description("Crear un post de blog completo")
  .option("-o, --output <file>", "Guardar resultado en archivo")
  .action(async (title: string, opts: { output?: string }) => {
    const { blogCommand } = await import("../src/commands/write.js");
    await blogCommand(title, opts);
  });

program
  .command("summarize <file>")
  .description("Resumir un documento (PDF, DOCX, TXT...)")
  .option("-o, --output <file>", "Guardar resumen en archivo")
  .action(async (file: string, opts: { output?: string }) => {
    const { summarizeCommand } = await import("../src/commands/summarize.js");
    await summarizeCommand(file, opts);
  });

program
  .command("analyze <file>")
  .description("Análisis profundo de un documento")
  .option("-o, --output <file>", "Guardar análisis en archivo")
  .action(async (file: string, opts: { output?: string }) => {
    const { summarizeCommand } = await import("../src/commands/summarize.js");
    await summarizeCommand(file, opts); // reuses summarize pipeline with different prompt
  });

program
  .command("rewrite <file>")
  .description("Reescribir un documento con tono específico")
  .option("--tone <tone>", "Tono (formal, informal, técnico, creativo)", "profesional")
  .option("-o, --output <file>", "Guardar resultado en archivo")
  .action(async (file: string, opts: { tone?: string; output?: string }) => {
    const { readFileSync } = await import("node:fs");
    const { rewriteCommand } = await import("../src/commands/write.js");
    const content = readFileSync(file, "utf-8");
    await rewriteCommand(content, opts);
  });

program
  .command("translate <file>")
  .description("Traducir un documento")
  .requiredOption("--to <language>", "Idioma destino (english, french, german...)")
  .option("-o, --output <file>", "Guardar traducción en archivo")
  .action(async (file: string, opts: { to: string; output?: string }) => {
    const { readFileSync } = await import("node:fs");
    const { translateCommand } = await import("../src/commands/write.js");
    const content = readFileSync(file, "utf-8");
    await translateCommand(content, opts.to, opts);
  });

// ─── Stats ─────────────────────────────────────────────────────────────────
program
  .command("stats")
  .description("Tokens usados por proyecto y proveedor")
  .action(async () => {
    const { getDb } = await import("../src/db/client.js");
    const chalk = (await import("chalk")).default;
    const db = getDb();
    const rows = db.prepare(`
      SELECT provider, model, SUM(input_tokens) as input, SUM(output_tokens) as output
      FROM token_usage GROUP BY provider, model ORDER BY output DESC
    `).all() as { provider: string; model: string; input: number; output: number }[];

    console.log(chalk.bold("\n✦ Uso de tokens\n"));
    if (rows.length === 0) {
      console.log(chalk.gray("  Sin uso registrado aún.\n"));
      return;
    }
    for (const r of rows) {
      console.log(`  ${chalk.cyan(r.provider)} ${chalk.gray(r.model)}`);
      console.log(chalk.gray(`    Entrada: ${r.input.toLocaleString()} · Salida: ${r.output.toLocaleString()}`));
    }
    console.log();
  });

program.parse();
