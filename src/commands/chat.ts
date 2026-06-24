/**
 * `writer chat` — Interactive conversation with memory.
 * Styled after Claude Code / opencode terminal UI.
 */

import { randomUUID }   from "node:crypto";
import { writeFileSync } from "node:fs";
import * as readline    from "node:readline";
import chalk            from "chalk";
import { getDb }        from "../db/client.js";
import { buildContext } from "../context/builder.js";
import { getProvider }  from "../providers/router.js";
import { getActiveProvider, getConfig } from "../auth/auth-manager.js";
import {
  printHeader,
  printTokenInfo,
  printSlashCommands,
  printSuccess,
  printError,
  printInfo,
  printUserBlock,
  printAgentBlock,
  inputPrompt,
  SLASH_COMMANDS,
} from "../ui.js";

// ─── DB helpers ───────────────────────────────────────────────────────────────

function getActiveProjectId(): string {
  const db  = getDb();
  const row = db
    .prepare("SELECT value FROM config WHERE key = 'active_project_id'")
    .get() as { value: string } | undefined;
  if (!row?.value) {
    printError("No hay proyecto activo. Ejecuta: writer init");
    process.exit(1);
  }
  return row.value;
}

function getActiveProjectName(projectId: string): string {
  const db      = getDb();
  const project = db
    .prepare("SELECT name FROM projects WHERE id = ?")
    .get(projectId) as { name: string } | undefined;
  return project?.name ?? "default";
}

function saveMessage(
  conversationId: string,
  role: "user" | "assistant",
  content: string,
  provider: string,
  model: string,
  tokens = 0,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO messages (id, conversation_id, role, content, provider, model, tokens_used)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), conversationId, role, content, provider, model, tokens);
}

function recordTokenUsage(
  projectId: string,
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO token_usage (id, project_id, provider, model, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), projectId, provider, model, inputTokens, outputTokens);
}

// ─── Session token tracking ───────────────────────────────────────────────────

interface SessionStats {
  totalInput:  number;
  totalOutput: number;
  turns:       number;
}

// ─── Slash command handlers ───────────────────────────────────────────────────

async function handleSlashCommand(
  input: string,
  ctx: {
    conversationId: string;
    projectId:      string;
    projectName:    string;
    providerName:   string;
    model:          string;
    session:        SessionStats;
    messages:       Array<{ role: string; content: string }>;
  },
): Promise<string> {
  const [cmd, ...args] = input.trim().split(/\s+/);

  switch (cmd) {
    case "/help": {
      process.stdout.write("\n");
      printSlashCommands();
      return "continue";
    }

    case "/clear": {
      console.clear();
      printHeader({
        projectName:  ctx.projectName,
        providerName: ctx.providerName,
        model:        ctx.model,
      });
      return "continue";
    }

    case "/status": {
      process.stdout.write("\n");
      console.log(chalk.bold.white("  Estado de sesión\n"));
      console.log(`  ${chalk.gray("Proyecto:")}  ${chalk.white(ctx.projectName)}`);
      console.log(`  ${chalk.gray("Proveedor:")} ${chalk.white(ctx.providerName)}`);
      console.log(`  ${chalk.gray("Modelo:")}    ${chalk.white(ctx.model)}`);
      console.log(`  ${chalk.gray("Turnos:")}    ${chalk.white(String(ctx.session.turns))}`);
      console.log(
        `  ${chalk.gray("Tokens:")}    ` +
        chalk.white(`${ctx.session.totalInput} entrada · ${ctx.session.totalOutput} salida`),
      );
      process.stdout.write("\n");
      return "continue";
    }

    case "/save": {
      const filename = args[0] ?? `conversacion-${new Date().toISOString().slice(0, 10)}.md`;
      try {
        const lines: string[] = [
          `# Conversación — ${ctx.projectName}`,
          `> ${new Date().toLocaleString("es")} · ${ctx.providerName} / ${ctx.model}`,
          "",
        ];
        for (const m of ctx.messages) {
          const role = m.role === "user" ? "**Tú**" : "**Writer Agent**";
          lines.push(`### ${role}\n\n${m.content}\n`);
          lines.push("---\n");
        }
        writeFileSync(filename, lines.join("\n"), "utf-8");
        printSuccess(`Conversación guardada en: ${filename}`);
      } catch (err) {
        printError(`No se pudo guardar: ${err instanceof Error ? err.message : String(err)}`);
      }
      return "continue";
    }

    case "/model": {
      const { modelCommand } = await import("./model.js");
      await modelCommand();
      return "continue";
    }

    case "/project": {
      process.stdout.write("\n");
      console.log(chalk.bold.white("  Proyecto activo\n"));
      console.log(`  ${chalk.cyan("●")} ${chalk.white.bold(ctx.projectName)}`);
      printInfo("Para cambiar de proyecto usa: writer project switch <nombre>");
      return "continue";
    }

    case "/init": {
      const { initCommand } = await import("./init.js");
      await initCommand();
      return "continue";
    }

    case "/login": {
      let provider = args[0];
      if (!provider) {
        const { select } = await import("../utils/prompts.js");
        provider = await select({
          message: "¿Qué proveedor deseas conectar?",
          choices: [
            { name: "OpenAI", value: "openai" },
            { name: "Anthropic", value: "anthropic" },
            { name: "Google (Gemini)", value: "google" },
            { name: "GitHub Copilot", value: "github-copilot" },
            { name: "Ollama (Local)", value: "ollama" },
            { name: "Groq", value: "groq" },
            { name: "DeepSeek", value: "deepseek" },
            { name: "Mistral", value: "mistral" },
            { name: "Personalizado (Custom)", value: "custom" },
            { name: "Cancelar", value: "cancel" },
          ],
        });
        if (provider === "cancel") return "continue";
      }
      const { loginCommand } = await import("./login.js");
      await loginCommand(provider);
      return "continue";
    }

    case "/logout": {
      let provider = args[0];
      if (!provider) {
        const { select } = await import("../utils/prompts.js");
        provider = await select({
          message: "¿Qué proveedor deseas desconectar?",
          choices: [
            { name: "OpenAI", value: "openai" },
            { name: "Anthropic", value: "anthropic" },
            { name: "Google (Gemini)", value: "google" },
            { name: "GitHub Copilot", value: "github-copilot" },
            { name: "Ollama (Local)", value: "ollama" },
            { name: "Groq", value: "groq" },
            { name: "DeepSeek", value: "deepseek" },
            { name: "Mistral", value: "mistral" },
            { name: "Personalizado (Custom)", value: "custom" },
            { name: "Cancelar", value: "cancel" },
          ],
        });
        if (provider === "cancel") return "continue";
      }
      const { logoutCommand } = await import("./login.js");
      await logoutCommand(provider);
      return "continue";
    }

    case "/stats": {
      const { getDb } = await import("../db/client.js");
      const db = getDb();
      const rows = db.prepare(`
        SELECT provider, model, SUM(input_tokens) as input, SUM(output_tokens) as output
        FROM token_usage GROUP BY provider, model ORDER BY output DESC
      `).all() as { provider: string; model: string; input: number; output: number }[];

      process.stdout.write("\n");
      console.log(chalk.bold.white("  ✦ Uso de tokens global\n"));
      if (rows.length === 0) {
        console.log(chalk.gray("    Sin uso registrado aún.\n"));
      } else {
        for (const r of rows) {
          console.log(`    ${chalk.cyan(r.provider)} ${chalk.gray(r.model)}`);
          console.log(chalk.gray(`      Entrada: ${r.input.toLocaleString()} · Salida: ${r.output.toLocaleString()}`));
        }
      }
      process.stdout.write("\n");
      return "continue";
    }

    case "/project-create": {
      let name = args[0];
      if (!name) {
        const { input } = await import("../utils/prompts.js");
        name = await input({ message: "Nombre del nuevo proyecto:" });
        if (!name) return "continue";
      }
      const { projectCreateCommand } = await import("./project.js");
      await projectCreateCommand(name);
      return "continue";
    }

    case "/project-list": {
      const { projectListCommand } = await import("./project.js");
      projectListCommand();
      return "continue";
    }

    case "/project-switch": {
      let name = args[0];
      if (!name) {
        const { select } = await import("../utils/prompts.js");
        const { getDb } = await import("../db/client.js");
        const projects = getDb().prepare("SELECT name FROM projects ORDER BY updated_at DESC").all() as { name: string }[];
        if (projects.length === 0) {
          printError("No hay proyectos.");
          return "continue";
        }
        name = await select({
          message: "Selecciona el proyecto:",
          choices: [
            ...projects.map(p => ({ name: p.name, value: p.name })),
            { name: "Cancelar", value: "cancel" }
          ]
        });
        if (name === "cancel") return "continue";
      }
      const { projectSwitchCommand } = await import("./project.js");
      projectSwitchCommand(name);
      // Update ctx project info since we switched
      const row = getDb().prepare("SELECT value FROM config WHERE key = 'active_project_id'").get() as { value: string };
      if (row?.value) {
        ctx.projectId = row.value;
        const project = getDb().prepare("SELECT name FROM projects WHERE id = ?").get(ctx.projectId) as { name: string };
        ctx.projectName = project?.name ?? "default";
      }
      return "continue";
    }

    case "/project-info": {
      const { projectInfoCommand } = await import("./project.js");
      projectInfoCommand();
      return "continue";
    }

    case "/chat-list": {
      const { chatListCommand } = await import("./chat.js"); // Call exported func from same file
      const selectedId = await chatListCommand();
      if (selectedId) {
        return `resume:${selectedId}`;
      }
      return "continue";
    }

    case "/doc-list": {
      const { docListCommand } = await import("./chat.js");
      await docListCommand();
      return "continue";
    }

    case "/load": {
      let file = args[0];
      if (!file) {
        const { input } = await import("../utils/prompts.js");
        file = await input({ message: "Arrastra el archivo aquí o escribe la ruta:" });
        if (!file) return "continue";
      }
      
      const { parseDocument } = await import("../readers/index.js");
      const { chunkText } = await import("../chunker.js");
      const { getDb } = await import("../db/client.js");
      const { randomUUID } = await import("node:crypto");
      const { basename } = await import("node:path");
      const { statSync } = await import("node:fs");

      
      try {
        const fileStats = statSync(file);
        const parsed = await parseDocument(file);
        const chunks = await chunkText(parsed.text);
        
        const db = getDb();
        const docId = randomUUID();
        const projectId = getActiveProjectId();
        
        db.prepare(`
          INSERT INTO documents (id, project_id, title, path, hash, size_bytes, format)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(docId, projectId, basename(file), file, "unknown", fileStats.size, file.split(".").pop());
        
        const insertChunk = db.prepare("INSERT INTO chunks (id, document_id, chunk_index, content, token_count) VALUES (?, ?, ?, ?, ?)");
        const insertFts = db.prepare("INSERT INTO chunks_fts (content, document_id) VALUES (?, ?)");
        
        for (const chunk of chunks) {
          insertChunk.run(randomUUID(), docId, chunk.index, chunk.content, chunk.tokenCount);
          try { insertFts.run(chunk.content, docId); } catch {}
        }
        
        printSuccess(`Documento cargado exitosamente. Ahora puedes hacerme preguntas sobre él.`);
        return "enable-context";
      } catch (err: any) {
        printError(`Error al cargar el archivo: ${err.message}`);
      }
      return "continue";
    }

    case "/write": {
      let prompt = args.join(" ");
      if (!prompt) {
        const { input } = await import("../utils/prompts.js");
        prompt = await input({ message: "¿De qué quieres que escriba?" });
        if (!prompt) return "continue";
      }
      const { writeCommand } = await import("./write.js");
      await writeCommand(prompt, {});
      return "continue";
    }

    case "/blog": {
      let title = args.join(" ");
      if (!title) {
        const { input } = await import("../utils/prompts.js");
        title = await input({ message: "Título del post de blog:" });
        if (!title) return "continue";
      }
      const { blogCommand } = await import("./write.js");
      await blogCommand(title, {});
      return "continue";
    }

    case "/summarize": {
      let file = args[0];
      if (!file) {
        const { input } = await import("../utils/prompts.js");
        file = await input({ message: "Ruta del archivo a resumir:" });
        if (!file) return "continue";
      }
      const { summarizeCommand } = await import("./summarize.js");
      await summarizeCommand(file, {});
      return "continue";
    }

    case "/analyze": {
      let file = args[0];
      if (!file) {
        const { input } = await import("../utils/prompts.js");
        file = await input({ message: "Ruta del archivo a analizar:" });
        if (!file) return "continue";
      }
      const { summarizeCommand } = await import("./summarize.js");
      await summarizeCommand(file, {}); // reuses summarize pipeline
      return "continue";
    }

    case "/rewrite": {
      let file = args[0];
      if (!file) {
        const { input } = await import("../utils/prompts.js");
        file = await input({ message: "Ruta del archivo a reescribir:" });
        if (!file) return "continue";
      }
      const { readFileSync } = await import("node:fs");
      const { rewriteCommand } = await import("./write.js");
      try {
        const content = readFileSync(args[0], "utf-8");
        await rewriteCommand(content, {});
      } catch (err) {
        printError(`No se pudo leer el archivo: ${err instanceof Error ? err.message : String(err)}`);
      }
      return "continue";
    }

    case "/translate": {
      let file = args[0] === "--to" ? args[2] : args[0];
      let targetLang = args.includes("--to") ? args[args.indexOf("--to") + 1] : undefined;

      if (!file) {
        const { input } = await import("../utils/prompts.js");
        file = await input({ message: "Ruta del archivo a traducir:" });
        if (!file) return "continue";
      }

      if (!targetLang) {
        const { input } = await import("../utils/prompts.js");
        targetLang = await input({ message: "Idioma destino (ej: english, spanish, french):", default: "english" });
        if (!targetLang) return "continue";
      }
      
      const { readFileSync } = await import("node:fs");
      const { translateCommand } = await import("./write.js");
      try {
        const content = readFileSync(file, "utf-8");
        await translateCommand(content, targetLang, {});
      } catch (err) {
        printError(`No se pudo leer el archivo: ${err instanceof Error ? err.message : String(err)}`);
      }
      return "continue";
    }

    case "/exit":
    case "/salir": {
      return "exit";
    }

    default: {
      printError(`Comando desconocido: ${cmd}. Escribe /help para ver los disponibles.`);
      return "continue";
    }
  }
}

// ─── Main chat command ────────────────────────────────────────────────────────

export async function chatCommand(opts: { context?: string; resume?: string; skipHeader?: boolean } = {}): Promise<void> {
  const db            = getDb();
  const projectId     = getActiveProjectId();
  const projectName   = getActiveProjectName(projectId);
  const activeId      = getActiveProvider();

  const DISPLAY_NAMES: Record<string, string> = {
    "openai":         "OpenAI",
    "openai-codex":   "ChatGPT Plus",
    "anthropic":      "Anthropic",
    "google":         "Google",
    "groq":           "Groq",
    "deepseek":       "DeepSeek",
    "mistral":        "Mistral",
    "github-copilot": "GitHub Copilot",
    "ollama":         "Ollama",
    "custom":         "Custom",
  };
  const providerDisplayName = DISPLAY_NAMES[activeId] ?? activeId;
  const configModel         = getConfig(`provider:${activeId}:model_light`) ?? "auto";

  if (!opts.skipHeader) {
    printHeader({
      projectName,
      providerName: providerDisplayName,
      model:        configModel,
    });
  }

  let conversationId = opts.resume || randomUUID();
  const localHistory: Array<{ role: string; content: string }> = [];
  let pastTurns = 0;

  if (opts.resume) {
    const conv = db.prepare("SELECT title FROM conversations WHERE id = ?").get(opts.resume) as { title: string } | undefined;
    if (!conv) {
      printError(`No se encontró el chat: ${opts.resume}`);
      return;
    }
    const msgs = db.prepare("SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC").all(opts.resume) as { role: string; content: string }[];
    
    if (msgs.length > 0) {
      printInfo(`Retomando chat: ${conv.title}`);
      for (const m of msgs) {
        localHistory.push({ role: m.role, content: m.content });
        if (m.role === "user") printUserBlock(m.content);
        else printAgentBlock(m.content);
      }
      pastTurns = msgs.filter(m => m.role === "user").length;
    }
  } else {
    const title = `Chat ${new Date().toLocaleString("es")}`;
    db.prepare(
      "INSERT INTO conversations (id, project_id, title) VALUES (?, ?, ?)",
    ).run(conversationId, projectId, title);
  }

  // Session stats
  const session: SessionStats = { totalInput: 0, totalOutput: 0, turns: pastTurns };

  // ─── readline with tab-completion ─────────────────────────────────────────

  const completer = (line: string): [string[], string] => {
    if (line.startsWith("/")) {
      const hits = SLASH_COMMANDS
        .map((c) => c.name)
        .filter((name) => name.startsWith(line));
      return [hits.length ? hits : [], line];
    }
    return [[], line];
  };

  // ─── Dynamic live menu for slash commands ──────────────────────────────────
  let currentMenuLines = 0;
  let selectedIndex = 0;
  let activeHits: typeof SLASH_COMMANDS = [];

  // Erase the previously drawn menu using relative cursor movement.
  // This is reliable even when the terminal has scrolled.
  const clearBottom = () => {
    if (currentMenuLines > 0) {
      // Move cursor down 1 line (to start of menu, below the input line)
      // then clear everything from that point downward, then move back up.
      process.stdout.write(`\x1b[${currentMenuLines}B`); // move down N lines
      process.stdout.write('\x1b[0J');                   // clear from cursor to end of screen
      process.stdout.write(`\x1b[${currentMenuLines}A`); // move back up N lines
      currentMenuLines = 0;
    }
  };

  let rl!: readline.Interface;
  let ask!: () => Promise<string>;
  let rlHistory: string[] = [];

  const setupRl = () => {
    rl = readline.createInterface({
      input:     process.stdin,
      output:    process.stdout,
      terminal:  true,
      completer,
    });

    // Restore history
    (rl as any).history = rlHistory;

    const renderBottom = () => {
      clearBottom();
      const line = rl.line;

      if (!line.startsWith('/')) {
        activeHits = [];
        return;
      }

      activeHits = SLASH_COMMANDS.filter((c) => c.name.startsWith(line));
      if (activeHits.length === 0) return;

      if (selectedIndex >= activeHits.length) selectedIndex = activeHits.length - 1;
      if (selectedIndex < 0) selectedIndex = 0;

      const remaining = SLASH_COMMANDS.length - activeHits.length;
      // Total lines below cursor: 1 blank + N items + maybe "↓ más" + separator + stats
      const totalLines = 1 + activeHits.length + (remaining > 0 ? 1 : 0) + 2;

      // Build the output string
      const nameWidth = Math.max(...activeHits.map((c) => c.name.length)) + 2;
      let out = '\n'; // move to line below cursor
      activeHits.forEach((cmd, i) => {
        const isSelected = i === selectedIndex;
        const arrow = isSelected ? chalk.cyan(">") : " ";
        const name  = isSelected
          ? chalk.cyan.bold(cmd.name.padEnd(nameWidth))
          : chalk.white(cmd.name.padEnd(nameWidth));
        out += `  ${arrow} ${name}  ${chalk.gray(cmd.description)}\n`;
      });
      if (remaining > 0) out += chalk.gray(`    ↓ ${remaining} más\n`);
      out += chalk.hex("#444444")("─".repeat(process.stdout.columns ?? 80)) + "\n";
      const kIn = (session.totalInput / 1000).toFixed(1);
      const kOut = (session.totalOutput / 1000).toFixed(1);
      out += chalk.dim(`~  ↑${kIn}k ↓${kOut}k tokens  (${activeProviderName} / ${activeModel})`) + "\n";

      // Write below current line, then move cursor back up to where it was
      process.stdout.write(out);
      process.stdout.write(`\x1b[${totalLines}A`); // move cursor back up
      currentMenuLines = totalLines;
    };

    // Intercept keystrokes
    const originalTtyWrite = (rl as any)._ttyWrite;
    (rl as any)._ttyWrite = function (s: string, key: any) {
      if (currentMenuLines > 0 && activeHits.length > 0 && key && rl.line.startsWith('/')) {
        if (key.name === 'up') {
          selectedIndex = Math.max(0, selectedIndex - 1);
          renderBottom();
          return; // swallow
        }
        if (key.name === 'down') {
          selectedIndex = Math.min(activeHits.length - 1, selectedIndex + 1);
          renderBottom();
          return; // swallow
        }
        if (key.name === 'tab') {
          (rl as any).line = activeHits[selectedIndex].name + " ";
          (rl as any).cursor = (rl as any).line.length;
          (rl as any)._refreshLine();
          renderBottom();
          return; // swallow
        }
        if (key.name === 'return' || key.name === 'enter') {
          if (rl.line !== activeHits[selectedIndex].name) {
            (rl as any).line = activeHits[selectedIndex].name;
            (rl as any).cursor = (rl as any).line.length;
            (rl as any)._refreshLine();
          }
          clearBottom();
          return originalTtyWrite.apply(this, arguments);
        }
      }

      const res = originalTtyWrite.apply(this, arguments);
      if (key && (key.name === 'return' || key.name === 'enter')) {
        clearBottom();
      } else {
        renderBottom();
      }
      return res;
    };

    ask = (): Promise<string> =>
      new Promise((resolve) => {
        rl.question(inputPrompt(), (answer) => {
          clearBottom();
          resolve(answer);
        });
        // Don't auto-render — menu only appears when user types /
      });

    rl.on("SIGINT", () => {
      printInfo(`Conversación guardada (${session.turns} turnos). ¡Hasta luego!`);
      process.stdout.write("\n");
      rl.close();
      process.exit(0);
    });
  };

  setupRl();

  // ─── Main loop ─────────────────────────────────────────────────────────────

  let activeProviderName = providerDisplayName;
  let activeModel        = configModel;
  let includeDocumentChunks = !!opts.context;

  while (true) {
    const userInput = await ask();
    
    // Calculate how many terminal lines the input took to erase the prompt properly
    const cols = process.stdout.columns || 80;
    const linesOfInput = userInput.split('\n').reduce((acc, line, idx) => {
      // The first line has a "  " prompt (2 chars)
      const pad = idx === 0 ? 2 : 0;
      return acc + Math.max(1, Math.ceil((line.length + pad) / cols));
    }, 0);
    
    // Move up: 1 line (for the Enter key newline) + linesOfInput (to get to the input line)
    // Wait, the top border is ABOVE the input line, so we need to go up 1 more line to reach the top border!
    // However, inputPrompt() prints `TopBorder\n  `. So the top border is 1 line above the first input line.
    const linesToMoveUp = 1 + linesOfInput;
    process.stdout.write(`\x1b[${linesToMoveUp}A\x1b[0J`); // Move up and clear everything below
    
    const trimmed = userInput.trim();

    if (!trimmed) continue;

    // ── slash commands ──────────────────────────────────────────────────────
    if (trimmed.startsWith("/")) {
      // If user typed just "/" show full command list
      if (trimmed === "/") {
        printSlashCommands();
        continue;
      }

      rlHistory = (rl as any).history || []; // Save history before closing
      rl.close(); // Temporarily close our readline so interactive prompts can work cleanly

      let result = "continue";
      try {
        result = await handleSlashCommand(trimmed, {
          conversationId,
          projectId,
          projectName,
          providerName:  activeProviderName,
          model:         activeModel,
          session,
          messages:      localHistory,
        });
      } catch (err: any) {
        // If user cancelled via Esc or Ctrl+C
        if (err.message?.includes("User force closed") || err.name === "ExitPromptError") {
          // just swallow and continue
        } else {
          printError(`Error: ${err.message}`);
        }
      } finally {
        setupRl(); // Recreate readline
      }

      if (result === "exit") {
        printInfo(`Conversación guardada (${session.turns} turnos). ¡Hasta luego!`);
        process.stdout.write("\n");
        rl.close();
        break;
      }
      if (result.startsWith("resume:")) {
        rl.close();
        process.stdout.write("\x1Bc"); // Reset terminal
        return chatCommand({ ...opts, resume: result.split(":")[1], skipHeader: false });
      }
      if (result === "enable-context") {
        includeDocumentChunks = true;
        continue;
      }
      continue;
    }

    // ── exit keywords ───────────────────────────────────────────────────────
    if (["exit", "salir", "quit"].includes(trimmed.toLowerCase())) {
      printInfo(`Conversación guardada (${session.turns} turnos). ¡Hasta luego!`);
      process.stdout.write("\n");
      break;
    }

    // ── intercept @file syntax ──────────────────────────────────────────────
    let finalQuery = trimmed;
    const fileMatches = trimmed.match(/@([^\s]+)/g);
    if (fileMatches) {
      const { parseDocument } = await import("../readers/index.js");
      const { existsSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      let hasFiles = false;
      let filesText = "\n\n--- Archivos adjuntos ---\n";
      for (const match of fileMatches) {
        const rawPath = match.substring(1); // remove @
        const fullPath = resolve(process.cwd(), rawPath);
        if (existsSync(fullPath)) {
          try {
            const parsed = await parseDocument(fullPath);
            filesText += `\nArchivo: ${rawPath}\n\`\`\`\n${parsed.text}\n\`\`\`\n`;
            hasFiles = true;
          } catch (e: any) {
            const { printError } = await import("../ui.js");
            printError(`No se pudo leer ${rawPath}: ${e.message}`);
          }
        }
      }
      if (hasFiles) {
        finalQuery += filesText;
      }
    }

    // ── save user message ───────────────────────────────────────────────────
    saveMessage(conversationId, "user", finalQuery, "", "", 0);
    localHistory.push({ role: "user", content: finalQuery });

    const { printUserBlock } = await import("../ui.js");
    printUserBlock(trimmed);

    // ── build context & get response ────────────────────────────────────────
    const messages = await buildContext({
      conversationId,
      projectId,
      userQuery:             finalQuery,
      includeDocumentChunks,
    });

    try {
      const { provider, model } = await getProvider();
      activeProviderName = provider.name ?? providerDisplayName;
      activeModel        = model;

      let fullResponse = "";
      
      // Initialize ora spinner
      const ora = (await import("ora")).default;
      const spinner = ora({
        text: chalk.gray("Working..."),
        color: "cyan",
        spinner: "dots"
      }).start();

      let firstChunk = true;
      const streamResult = await provider.stream(
        messages,
        (chunk) => {
          if (firstChunk) {
            spinner.stop(); // Clear spinner when first chunk arrives
            process.stdout.write("\n  "); // Add initial padding for the assistant block
            firstChunk = false;
          }
          fullResponse += chunk;
          process.stdout.write(chalk.white(chunk.replace(/\n/g, "\n  ")));
        },
        { model },
      );
      
      if (firstChunk) spinner.stop(); // Just in case stream was empty
      process.stdout.write("\n\n");

      const inputTok  = streamResult.inputTokens  ?? 0;
      const outputTok = streamResult.outputTokens ?? Math.ceil(fullResponse.length / 4);

      printTokenInfo({
        inputTokens:  inputTok,
        outputTokens: outputTok,
        provider:     activeProviderName,
        model:        activeModel,
      });

      // Save & record
      saveMessage(conversationId, "assistant", fullResponse, provider.id, model, outputTok);
      recordTokenUsage(projectId, provider.id, model, inputTok, outputTok);
      localHistory.push({ role: "assistant", content: fullResponse });

      session.totalInput  += inputTok;
      session.totalOutput += outputTok;
      session.turns++;

      db.prepare(
        "UPDATE conversations SET updated_at = datetime('now') WHERE id = ?",
      ).run(conversationId);

    } catch (err) {
      process.stdout.write("\n");
      printError(
        `Error al obtener respuesta: ${err instanceof Error ? err.message : String(err)}`,
      );
      printInfo("Verifica tu configuración con: writer status");
      process.stdout.write("\n");
    }
  }

  rl.close();
}

// ─── chat list ────────────────────────────────────────────────────────────────

export async function chatListCommand(): Promise<string | null> {
  const db        = getDb();
  const projectId = getActiveProjectId();

  let conversations = db
    .prepare(
      `SELECT id, title, created_at, updated_at,
         (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) as message_count
       FROM conversations
       WHERE project_id = ? AND (SELECT COUNT(*) FROM messages WHERE conversation_id = conversations.id) > 0
       ORDER BY updated_at DESC
       LIMIT 50`
    )
    .all(projectId) as any[];

  if (conversations.length === 0) {
    printInfo("No hay conversaciones aún. Ejecuta: writer chat");
    return null;
  }

  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;
    let confirmingDelete = false;

    const render = () => {
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
      }
      
      let out = "\n" + chalk.bold.white("  Conversaciones ") + chalk.gray("(↑/↓ navegar • Enter seleccionar • Suprimir/D borrar • Esc salir)\n\n");
      let lines = 3;

      if (conversations.length === 0) {
        out += chalk.gray("  (No quedan conversaciones)\n");
        lines += 1;
      } else {
        conversations.forEach((c, i) => {
          const isSelected = i === selectedIndex;
          const arrow = isSelected ? chalk.cyan("❯") : " ";
          
          if (isSelected) {
            out += `  ${arrow} ${chalk.cyan.bold(c.id.slice(0, 8))}  ${chalk.white.bold(c.title)}\n`;
          } else {
            out += `  ${arrow} ${chalk.gray(c.id.slice(0, 8))}  ${chalk.gray(c.title)}\n`;
          }
          out += `      ${chalk.gray(`${c.message_count} mensajes · ${c.updated_at}`)}\n`;
          lines += 2;
        });
      }

      if (confirmingDelete && conversations.length > 0) {
        out += `\n  ${chalk.bgRed.white.bold(" ADVERTENCIA ")} ¿Estás seguro de eliminar esta sesión permanentemente? ${chalk.gray("(S para confirmar / N para cancelar)")}\n`;
        lines += 2;
      }

      process.stdout.write(out);
      renderedLines = lines;
    };

    render();

    const onKeypress = (str: string, key: any) => {
      if (!key) return;

      if (confirmingDelete) {
        const char = key.name ? key.name.toLowerCase() : str.toLowerCase();
        if (char === "s" || char === "y" || char === "return" || char === "enter") {
          // Confirm delete
          const id = conversations[selectedIndex].id;
          db.prepare("DELETE FROM conversations WHERE id = ?").run(id);
          db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(id);
          
          conversations = conversations.filter((_, i) => i !== selectedIndex);
          if (selectedIndex >= conversations.length) {
            selectedIndex = Math.max(0, conversations.length - 1);
          }
          confirmingDelete = false;
          render();
        } else if (char === "n" || char === "escape" || (key.ctrl && key.name === "c")) {
          // Cancel delete
          confirmingDelete = false;
          render();
        }
        return;
      }

      if (key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
      } else if (key.name === "down") {
        selectedIndex = Math.min(conversations.length - 1, selectedIndex + 1);
        render();
      } else if (key.name === "return" || key.name === "enter") {
        cleanup();
        if (conversations.length > 0) resolve(conversations[selectedIndex].id);
        else resolve(null);
      } else if (key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        resolve(null);
      } else if ((key.ctrl && key.name === "d") || key.name === "backspace" || key.name === "delete" || key.name === "d") {
        if (conversations.length > 0) {
          confirmingDelete = true;
          render();
        }
      }
    };

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("keypress", onKeypress);
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
      }
    };

    import("node:readline").then((readline) => {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("keypress", onKeypress);
    });
  });
}

export async function docListCommand(): Promise<void> {
  const db        = getDb();
  const projectId = getActiveProjectId();

  let documents = db
    .prepare(
      `SELECT id, title, created_at, size_bytes
       FROM documents
       WHERE project_id = ?
       ORDER BY created_at DESC
       LIMIT 50`
    )
    .all(projectId) as any[];

  if (documents.length === 0) {
    printInfo("No hay documentos cargados en este proyecto.");
    return;
  }

  return new Promise((resolve) => {
    let selectedIndex = 0;
    let renderedLines = 0;
    let confirmingDelete = false;

    const render = () => {
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
      }
      
      let out = "\n" + chalk.bold.white("  Documentos ") + chalk.gray("(↑/↓ navegar • Suprimir/D borrar • Esc salir)\n\n");
      let lines = 3;

      if (documents.length === 0) {
        out += chalk.gray("  (No quedan documentos)\n");
        lines += 1;
      } else {
        documents.forEach((d, i) => {
          const isSelected = i === selectedIndex;
          const arrow = isSelected ? chalk.cyan("❯") : " ";
          
          if (isSelected) {
            out += `  ${arrow} ${chalk.cyan.bold(d.title)}\n`;
          } else {
            out += `  ${arrow} ${chalk.white(d.title)}\n`;
          }
          const kb = Math.round((d.size_bytes || 0) / 1024);
          out += `      ${chalk.gray(`${kb} KB · ${d.created_at}`)}\n`;
          lines += 2;
        });
      }

      if (confirmingDelete && documents.length > 0) {
        out += `\n  ${chalk.bgRed.white.bold(" ADVERTENCIA ")} ¿Estás seguro de eliminar este documento y todo su contexto? ${chalk.gray("(S para confirmar / N para cancelar)")}\n`;
        lines += 2;
      }

      process.stdout.write(out);
      renderedLines = lines;
    };

    render();

    const onKeypress = (str: string, key: any) => {
      if (!key) return;

      if (confirmingDelete) {
        const char = key.name ? key.name.toLowerCase() : str.toLowerCase();
        if (char === "s" || char === "y" || char === "return" || char === "enter") {
          // Confirm delete
          const id = documents[selectedIndex].id;
          db.prepare("DELETE FROM documents WHERE id = ?").run(id);
          
          documents = documents.filter((_, i) => i !== selectedIndex);
          if (selectedIndex >= documents.length) {
            selectedIndex = Math.max(0, documents.length - 1);
          }
          confirmingDelete = false;
          render();
        } else if (char === "n" || char === "escape" || (key.ctrl && key.name === "c")) {
          // Cancel delete
          confirmingDelete = false;
          render();
        }
        return;
      }

      if (key.name === "up") {
        selectedIndex = Math.max(0, selectedIndex - 1);
        render();
      } else if (key.name === "down") {
        selectedIndex = Math.min(documents.length - 1, selectedIndex + 1);
        render();
      } else if (key.name === "return" || key.name === "enter" || key.name === "escape" || (key.ctrl && key.name === "c")) {
        cleanup();
        resolve();
      } else if ((key.ctrl && key.name === "d") || key.name === "backspace" || key.name === "delete" || key.name === "d") {
        if (documents.length > 0) {
          confirmingDelete = true;
          render();
        }
      }
    };

    const cleanup = () => {
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("keypress", onKeypress);
      if (renderedLines > 0) {
        process.stdout.write(`\x1b[${renderedLines}A\x1b[0J`);
      }
    };

    import("node:readline").then((readline) => {
      readline.emitKeypressEvents(process.stdin);
      if (process.stdin.isTTY) process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on("keypress", onKeypress);
    });
  });
}
