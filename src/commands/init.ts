/**
 * `writer init` — Interactive setup wizard.
 * Creates the SQLite database, workspace directory, and default project.
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import { getDb } from "../db/client.js";
import { loginOllama } from "../auth/auth-manager.js";

const WORKSPACE_DIR = join(homedir(), "writer-workspace");

export async function initCommand(): Promise<void> {
  console.log(chalk.bold.magenta("\n✦ Writer Agent — Setup inicial\n"));

  // Check if already initialized
  const db = getDb();
  const existing = db.prepare("SELECT id FROM projects WHERE name = 'default'").get() as { id: string } | undefined;
  if (existing) {
    const proceed = await confirm({ message: "Ya existe una configuración. ¿Deseas reinicializar?", default: false });
    if (!proceed) {
      // Ensure active project is set even if not re-initializing
      const active = db.prepare("SELECT value FROM config WHERE key = 'active_project_id'").get() as { value: string } | undefined;
      if (!active?.value) {
        db.prepare(`
          INSERT INTO config (key, value) VALUES ('active_project_id', ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(existing.id);
        console.log(chalk.green("✓ Proyecto 'default' existente marcado como activo."));
      }
      console.log(chalk.gray("Setup cancelado."));
      return;
    }
  }

  // Choose workspace directory
  const workspaceInput = await input({
    message: "Directorio de workspace:",
    default: WORKSPACE_DIR,
  });
  const workspacePath = workspaceInput.trim() || WORKSPACE_DIR;

  if (!existsSync(workspacePath)) {
    mkdirSync(workspacePath, { recursive: true });
    console.log(chalk.green(`✓ Creado: ${workspacePath}`));
  }

  // Create default project
  const defaultProjectPath = join(workspacePath, "default");
  if (!existsSync(defaultProjectPath)) {
    mkdirSync(defaultProjectPath, { recursive: true });
    mkdirSync(join(defaultProjectPath, "conversaciones"), { recursive: true });
  }

  // Write .context.yml for default project
  writeFileSync(
    join(defaultProjectPath, ".context.yml"),
    `# Writer Agent — Proyecto: default\nidioma: es\ntono: profesional\n`,
  );

  // Insert default project into DB
  const projectId = randomUUID();
  db.prepare(`
    INSERT OR REPLACE INTO projects (id, name, description, path)
    VALUES (?, ?, ?, ?)
  `).run(projectId, "default", "Proyecto por defecto de Writer Agent", defaultProjectPath);

  // Set active project
  db.prepare(`
    INSERT INTO config (key, value) VALUES ('active_project_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(projectId);

  db.prepare(`
    INSERT INTO config (key, value) VALUES ('workspace_path', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(workspacePath);

  console.log(chalk.green("✓ Proyecto 'default' creado"));

  // Choose provider
  const provider = await select({
    message: "¿Qué proveedor de IA deseas usar por defecto?",
    choices: [
      { name: "Ollama (local, gratis)", value: "ollama" },
      { name: "GitHub Copilot (suscripción existente)", value: "github-copilot" },
      { name: "ChatGPT Plus/Pro (suscripción existente)", value: "openai-codex" },
      { name: "Anthropic (API Key)", value: "anthropic" },
      { name: "OpenAI (API Key)", value: "openai" },
      { name: "Configurar después", value: "none" },
    ],
  });

  if (provider === "ollama") {
    loginOllama();
    console.log(chalk.green("✓ Ollama configurado en localhost:11434"));
  } else if (provider !== "none") {
    console.log(chalk.yellow(`\nEjecuta: writer login ${provider}`));
  }

  console.log(chalk.bold.green("\n🎉 Writer Agent listo!\n"));
  console.log(chalk.gray("  writer chat        → Iniciar conversación"));
  console.log(chalk.gray("  writer write \"...\" → Redactar con IA"));
  console.log(chalk.gray("  writer status      → Ver proveedores\n"));
}
