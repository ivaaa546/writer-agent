/**
 * `writer project` — CRUD for projects.
 */

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { getDb } from "../db/client.js";

function getWorkspacePath(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = 'workspace_path'").get() as { value: string } | undefined;
  return row?.value ?? join(process.env["HOME"] ?? "~", "writer-workspace");
}

function getActiveProjectId(): string | null {
  const db = getDb();
  const row = db.prepare("SELECT value FROM config WHERE key = 'active_project_id'").get() as { value: string } | undefined;
  return row?.value ?? null;
}

function setActiveProjectId(id: string): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO config (key, value) VALUES ('active_project_id', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(id);
}

export async function projectCreateCommand(name: string): Promise<void> {
  const db = getDb();
  const workspacePath = getWorkspacePath();
  const projectPath = join(workspacePath, name);

  if (!existsSync(projectPath)) {
    mkdirSync(projectPath, { recursive: true });
    mkdirSync(join(projectPath, "conversaciones"), { recursive: true });
  }

  writeFileSync(
    join(projectPath, ".context.yml"),
    `# Writer Agent — Proyecto: ${name}\nidioma: es\ntono: profesional\n`,
  );

  const id = randomUUID();
  db.prepare("INSERT INTO projects (id, name, path) VALUES (?, ?, ?)").run(id, name, projectPath);

  console.log(chalk.bold.green(`\n✓ Proyecto '${name}' creado en ${projectPath}`));
  console.log(chalk.gray(`  Ejecuta: writer project switch ${name} para activarlo\n`));
}

export function projectListCommand(): void {
  const db = getDb();
  const projects = db.prepare("SELECT id, name, description, path, created_at FROM projects ORDER BY created_at DESC").all() as {
    id: string;
    name: string;
    description: string | null;
    path: string;
    created_at: string;
  }[];

  const activeId = getActiveProjectId();
  console.log(chalk.bold("\n✦ Proyectos\n"));

  if (projects.length === 0) {
    console.log(chalk.gray("  No hay proyectos. Ejecuta: writer init\n"));
    return;
  }

  for (const p of projects) {
    const isActive = p.id === activeId;
    const indicator = isActive ? chalk.green("→ ") : "  ";
    const name = isActive ? chalk.bold.green(p.name) : chalk.white(p.name);
    const desc = p.description ? chalk.gray(` — ${p.description}`) : "";
    console.log(`${indicator}${name}${desc}`);
    console.log(chalk.gray(`     ${p.path}`));
  }
  console.log();
}

export function projectSwitchCommand(name: string): void {
  const db = getDb();
  const project = db.prepare("SELECT id, name FROM projects WHERE name = ?").get(name) as { id: string; name: string } | undefined;

  if (!project) {
    console.error(chalk.red(`✗ Proyecto '${name}' no encontrado.`));
    console.log(chalk.gray("  Usa: writer project list para ver proyectos disponibles"));
    process.exit(1);
  }

  setActiveProjectId(project.id);
  console.log(chalk.bold.green(`\n✓ Proyecto activo: ${project.name}\n`));
}

export function projectInfoCommand(): void {
  const db = getDb();
  const activeId = getActiveProjectId();

  if (!activeId) {
    console.log(chalk.yellow("No hay proyecto activo. Ejecuta: writer init"));
    return;
  }

  const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(activeId) as {
    id: string;
    name: string;
    description: string | null;
    path: string;
    created_at: string;
  } | undefined;

  if (!project) {
    console.log(chalk.yellow("Proyecto activo no encontrado en la base de datos."));
    return;
  }

  const docCount = (db.prepare("SELECT COUNT(*) as count FROM documents WHERE project_id = ?").get(activeId) as { count: number }).count;
  const convCount = (db.prepare("SELECT COUNT(*) as count FROM conversations WHERE project_id = ?").get(activeId) as { count: number }).count;

  console.log(chalk.bold("\n✦ Proyecto activo\n"));
  console.log(`  ${chalk.cyan("Nombre:")}    ${project.name}`);
  console.log(`  ${chalk.cyan("Ruta:")}      ${project.path}`);
  console.log(`  ${chalk.cyan("Creado:")}    ${project.created_at}`);
  console.log(`  ${chalk.cyan("Docs:")}      ${docCount}`);
  console.log(`  ${chalk.cyan("Chats:")}     ${convCount}`);
  console.log();
}
