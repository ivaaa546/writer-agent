/**
 * ui.ts — Writer Agent terminal UI utilities.
 * Provides Claude Code / opencode style rendering for the interactive chat.
 */

import chalk from "chalk";

// ─── Terminal width helpers ───────────────────────────────────────────────────

export function termWidth(): number {
  return process.stdout.columns ?? 80;
}

function line(char = "─", width?: number): string {
  return char.repeat(width ?? termWidth());
}

// ─── Slash Commands ───────────────────────────────────────────────────────────

export interface SlashCommand {
  name: string;       // e.g. "/help"
  description: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Comandos Internos
  { name: "/help",           description: "Ver todos los comandos disponibles" },
  { name: "/clear",          description: "Limpiar la pantalla" },
  { name: "/status",         description: "Proveedor conectado y tokens de sesión" },
  { name: "/save",           description: "Guardar conversación en un archivo .md" },
  { name: "/model",          description: "Te permite configurar/cambiar los modelos que usa el proveedor activo" },
  { name: "/project",        description: "Ver o cambiar el proyecto activo" },
  { name: "/exit",           description: "Salir del agente" },

  // Configuración y Estado
  { name: "/init",           description: "Inicializa el workspace" },
  { name: "/login",          description: "Conecta un proveedor (ej: /login openai)" },
  { name: "/logout",         description: "Desconecta un proveedor" },
  { name: "/stats",          description: "Estadísticas de tokens por proyecto" },

  // Proyectos
  { name: "/project-create", description: "Crea un proyecto nuevo (ej: /project-create tesis)" },
  { name: "/project-list",   description: "Lista los proyectos" },
  { name: "/project-switch", description: "Cambia de proyecto (ej: /project-switch tesis)" },
  { name: "/project-info",   description: "Muestra información del proyecto activo" },

  // Chat
  { name: "/chat-list",      description: "Historial de conversaciones" },
  { name: "/load",           description: "Carga un archivo al contexto del chat (ej: /load doc.pdf)" },

  // Escritura y Documentos
  { name: "/doc-list",       description: "Ver o eliminar documentos cargados en el proyecto" },
  { name: "/write",          description: "Redacta texto (ej: /write un poema corto)" },
  { name: "/blog",           description: "Crea un post de blog (ej: /blog Inteligencia Artificial)" },
  { name: "/summarize",      description: "Resume un archivo (ej: /summarize doc.pdf)" },
  { name: "/analyze",        description: "Analiza un archivo en profundidad" },
  { name: "/rewrite",        description: "Reescribe un archivo aplicando un tono" },
  { name: "/translate",      description: "Traduce un archivo (ej: /translate doc.pdf --to english)" },
];

/**
 * Prints the slash command list filtered by `filter`.
 * Mimics the Claude Code / opencode autocomplete dropdown.
 */
export function printSlashCommands(filter = ""): void {
  const matched = SLASH_COMMANDS.filter((c) =>
    c.name.startsWith(filter || "/")
  );

  if (matched.length === 0) return;

  process.stdout.write("\n");

  const nameWidth = Math.max(...matched.map((c) => c.name.length)) + 2;

  matched.forEach((cmd, i) => {
    const isFirst = i === 0;
    const arrow = isFirst ? chalk.cyan(">") : " ";
    const name  = isFirst
      ? chalk.cyan.bold(cmd.name.padEnd(nameWidth))
      : chalk.white(cmd.name.padEnd(nameWidth));
    const desc  = chalk.gray(cmd.description);
    console.log(`  ${arrow} ${name}  ${desc}`);
  });

  const remaining = SLASH_COMMANDS.length - matched.length;
  if (remaining > 0) {
    console.log(chalk.gray(`  ↓ ${remaining} más`));
  }

  process.stdout.write("\n");
}

// ─── Header ───────────────────────────────────────────────────────────────────

/**
 * Prints the welcome header box with project, provider, and model info.
 */
export function printHeader(opts: {
  projectName: string;
  providerName?: string;
  model?: string;
}): void {
  const { projectName, providerName = "–", model = "–" } = opts;

  process.stdout.write("\n");
  
  // Minimalist, modern header without boxes
  console.log(`  ${chalk.bold("WRITER AGENT")}`);
  console.log();
  console.log(`  ${chalk.gray("Proyecto:")}  ${chalk.white(projectName)}`);
  console.log(`  ${chalk.gray("Modelo:")}    ${chalk.cyan(`${providerName} / ${model}`)}`);
  console.log(`  ${chalk.gray("Ayuda:")}     ${chalk.gray("Escribe / para comandos  ·  Ctrl+C para salir")}`);
  console.log();
  
  // A subtle divider
  console.log(chalk.hex("#333333")("─".repeat(process.stdout.columns ?? 80)));
  process.stdout.write("\n");
}

// ─── Blocks ───────────────────────────────────────────────────────────────────

/**
 * Splits text into wrapped lines up to maxWidth
 */
function wrapText(text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    // Basic wrap
    if ((currentLine + " " + word).length > maxWidth) {
      if (currentLine) lines.push(currentLine.trim());
      currentLine = word;
    } else {
      currentLine += (currentLine ? " " : "") + word;
    }
  }
  if (currentLine) lines.push(currentLine.trim());
  return lines;
}

/**
 * Prints the user message inside a full-width dark gray block.
 */
export function printUserBlock(text: string): void {
  const width = termWidth();
  const bg = chalk.bgHex("#2b2b2b");
  const fg = chalk.hex("#e0e0e0"); // Light gray text
  
  process.stdout.write("\n");
  const lines = text.split("\n").flatMap(l => wrapText(l, width - 4));
  
  // Padding top
  console.log(bg(" ".repeat(width)));
  for (const line of lines) {
    const padded = `  ${line}`;
    console.log(bg(fg(padded) + " ".repeat(Math.max(0, width - padded.length))));
  }
  // Padding bottom
  console.log(bg(" ".repeat(width)));
  process.stdout.write("\n");
}

/**
 * Prints the agent message inside a transparent or very slightly tinted block.
 */
export function printAgentBlock(text: string): void {
  const width = termWidth();
  // Using transparent/native background for the assistant, just adding padding
  process.stdout.write("\n");
  const lines = text.split("\n");
  for (const line of lines) {
    console.log(`  ${line}`);
  }
  process.stdout.write("\n");
}

/**
 * Prints token usage info after an agent response.
 */
export function printTokenInfo(opts: {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}): void {
  const { inputTokens, outputTokens, provider, model } = opts;
  const info = `${inputTokens} → ${outputTokens} tokens  ·  ${provider} / ${model}`;
  // Right-align within terminal width
  const width = termWidth();
  const padding = Math.max(0, width - info.length - 2);
  process.stdout.write("\n" + " ".repeat(padding) + chalk.gray(info) + "\n");
}

/**
 * Returns the styled input prompt string (only the top border of the box).
 */
export function inputPrompt(): string {
  const width = termWidth();
  // A dark subtle horizontal line for the top of the input box
  return chalk.hex("#444444")("─".repeat(width)) + "\n  ";
}

// ─── Inline messages ──────────────────────────────────────────────────────────

export function printSuccess(msg: string): void {
  console.log(chalk.green(`\n  ✓ ${msg}`));
}

export function printError(msg: string): void {
  console.log(chalk.red(`\n  ✗ ${msg}`));
}

export function printInfo(msg: string): void {
  console.log(chalk.gray(`\n  ${msg}`));
}
