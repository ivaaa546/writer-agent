/**
 * `writer login <provider>` — handles all authentication flows.
 */

import { input, password, select } from "@inquirer/prompts";
import open from "open";
import chalk from "chalk";
import ora from "ora";
import {
  loginWithApiKey,
  loginWithOAuth,
  loginOllama,
  loginCustomEndpoint,
  logout,
  getAllProviderStatuses,
} from "../auth/auth-manager.js";
import type { OAuthLoginCallbacks } from "../auth/oauth/types.js";

// ─── Shared OAuth callbacks (CLI UI) ──────────────────────────────────────

function buildOAuthCallbacks(): OAuthLoginCallbacks {
  return {
    onAuth: async ({ url, instructions }) => {
      console.log(chalk.cyan("\n→ " + (instructions ?? "Abriendo navegador para autenticación...")));
      console.log(chalk.gray(`  URL: ${url}\n`));
      try {
        await open(url);
      } catch {
        console.log(chalk.yellow("  No se pudo abrir el navegador automáticamente. Copia la URL de arriba."));
      }
    },

    onDeviceCode: (info) => {
      console.log(chalk.bold.cyan("\n→ Autenticación con código de dispositivo\n"));
      console.log(`  Código:  ${chalk.bold.yellow(info.userCode)}`);
      console.log(`  URL:     ${chalk.underline(info.verificationUri)}`);
      console.log(chalk.gray(`\n  Esperando confirmación...`));
    },

    onPrompt: async (prompt) => {
      return input({ message: prompt.message });
    },

    onProgress: (message) => {
      console.log(chalk.gray(`  ${message}`));
    },

    onSelect: async ({ message, options }) => {
      return select({
        message,
        choices: options.map((o) => ({ name: o.label, value: o.id })),
      });
    },
  };
}

// ─── Login handlers ────────────────────────────────────────────────────────

async function loginCopilot(): Promise<void> {
  const spinner = ora("Iniciando flujo OAuth de GitHub Copilot...").start();
  spinner.stop();
  const callbacks = buildOAuthCallbacks();
  try {
    const creds = await loginWithOAuth("github-copilot", callbacks);
    console.log(chalk.bold.green("\n✓ GitHub Copilot conectado exitosamente"));
    if (creds.accountId) console.log(chalk.gray(`  Account ID: ${creds.accountId}`));
  } catch (err) {
    console.error(chalk.red("\n✗ Error al conectar GitHub Copilot:"), err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function loginOpenAICodex(): Promise<void> {
  const callbacks = buildOAuthCallbacks();
  try {
    const creds = await loginWithOAuth("openai-codex", callbacks);
    console.log(chalk.bold.green("\n✓ ChatGPT Plus/Pro conectado exitosamente"));
    if (creds.accountId) console.log(chalk.gray(`  Account ID: ${creds.accountId}`));
  } catch (err) {
    console.error(chalk.red("\n✗ Error al conectar OpenAI:"), err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

async function loginApiKey(provider: string, label: string): Promise<void> {
  const apiKey = await password({ message: `API Key de ${label}:` });
  if (!apiKey.trim()) {
    console.log(chalk.yellow("No se proporcionó API Key."));
    return;
  }
  const spinner = ora("Guardando credenciales...").start();
  try {
    await loginWithApiKey(provider, apiKey.trim());
    spinner.succeed(chalk.bold.green(`${label} conectado exitosamente`));
  } catch (err) {
    spinner.fail("Error al guardar credenciales");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

async function loginOllamaCmd(): Promise<void> {
  const urlInput = await input({
    message: "URL base de Ollama:",
    default: "http://localhost:11434",
  });
  const baseUrl = urlInput.trim() || "http://localhost:11434";
  const spinner = ora("Verificando conexión con Ollama...").start();
  try {
    const resp = await fetch(`${baseUrl}/api/tags`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    loginOllama(baseUrl);
    spinner.succeed(chalk.bold.green("Ollama conectado en " + baseUrl));
    const data = await resp.json() as { models?: { name: string }[] };
    if (data.models?.length) {
      console.log(chalk.gray(`  Modelos disponibles: ${data.models.map((m) => m.name).join(", ")}`));
    }
  } catch {
    loginOllama(baseUrl);
    spinner.warn(chalk.yellow(`Ollama configurado en ${baseUrl} (no se pudo verificar la conexión)`));
  }
}

async function loginCustomCmd(): Promise<void> {
  const baseUrl = await input({
    message: "URL base del endpoint (ej: http://localhost:1234/v1):",
    default: "http://localhost:1234/v1",
  });
  const model = await input({
    message: "Modelo por defecto (deja vacío para auto-detectar):",
    default: "",
  });
  loginCustomEndpoint(baseUrl.trim(), model.trim() || undefined);
  console.log(chalk.bold.green(`\n✓ Endpoint personalizado configurado: ${baseUrl}`));
}

// ─── Status command ────────────────────────────────────────────────────────

export async function statusCommand(): Promise<void> {
  console.log(chalk.bold("\n✦ Estado de proveedores\n"));
  const statuses = await getAllProviderStatuses();
  for (const s of statuses) {
    const icon = s.connected ? chalk.green("●") : chalk.gray("○");
    const method = s.method ? chalk.gray(` [${s.method}${s.source ? `: ${s.source}` : ""}]`) : "";
    console.log(`  ${icon} ${s.name}${method}`);
  }
  console.log();
}

// ─── Logout command ────────────────────────────────────────────────────────

export async function logoutCommand(provider: string): Promise<void> {
  const spinner = ora(`Desconectando ${provider}...`).start();
  await logout(provider);
  spinner.succeed(`${provider} desconectado`);
}

// ─── Main login dispatcher ─────────────────────────────────────────────────

export async function loginCommand(provider: string): Promise<void> {
  switch (provider) {
    case "copilot":
    case "github-copilot":
      await loginCopilot();
      break;
    case "openai":
    case "openai-codex":
    case "chatgpt":
      await loginOpenAICodex();
      break;
    case "anthropic":
    case "claude":
      await loginApiKey("anthropic", "Anthropic (Claude)");
      break;
    case "google":
    case "gemini":
      await loginApiKey("google", "Google Gemini");
      break;
    case "groq":
      await loginApiKey("groq", "Groq");
      break;
    case "deepseek":
      await loginApiKey("deepseek", "DeepSeek");
      break;
    case "mistral":
      await loginApiKey("mistral", "Mistral");
      break;
    case "ollama":
      await loginOllamaCmd();
      break;
    case "custom":
      await loginCustomCmd();
      break;
    default:
      console.error(chalk.red(`Proveedor desconocido: ${provider}`));
      console.log(chalk.gray("Proveedores disponibles: copilot, openai, anthropic, google, groq, deepseek, mistral, ollama, custom"));
      process.exit(1);
  }
}
