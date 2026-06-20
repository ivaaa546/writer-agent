/**
 * `writer write` — AI-assisted writing command.
 * Also handles: blog, rewrite, analyze
 */

import { writeFileSync } from "node:fs";
import chalk from "chalk";
import ora from "ora";
import { getProvider } from "../providers/router.js";
import type { Message } from "../providers/base.js";
import type { TaskType } from "../providers/router.js";

interface WriteOptions {
  output?: string;
  tone?: string;
  format?: string;
  model?: "light" | "heavy";
}

async function runWriteTask(
  systemPrompt: string,
  userPrompt: string,
  task: TaskType,
  opts: WriteOptions = {},
): Promise<void> {
  const spinner = ora("Generando contenido...").start();

  try {
    const { provider, model } = await getProvider(task);
    spinner.text = `Escribiendo con ${provider.name} (${model})...`;
    spinner.stop();

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ];

    let fullContent = "";
    process.stdout.write(chalk.bold.white("\n"));

    await provider.stream(messages, (chunk) => {
      process.stdout.write(chalk.white(chunk));
      fullContent += chunk;
    }, { model });

    process.stdout.write("\n");

    if (opts.output) {
      const content = opts.format === "md" || !opts.format
        ? fullContent
        : fullContent; // TODO: DOCX conversion in V2
      writeFileSync(opts.output, content, "utf-8");
      console.log(chalk.green(`\n✓ Guardado en: ${opts.output}`));
    }

    console.log(chalk.gray(`\n  Modelo: ${model} · Proveedor: ${provider.name}\n`));
  } catch (err) {
    spinner.fail("Error al generar contenido");
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }
}

export async function writeCommand(prompt: string, opts: WriteOptions = {}): Promise<void> {
  const tone = opts.tone ?? "profesional";
  await runWriteTask(
    `Eres un escritor experto. Escribe de forma ${tone}, clara y bien estructurada. Usa Markdown cuando sea apropiado.`,
    prompt,
    "blog",
    opts,
  );
}

export async function blogCommand(title: string, opts: WriteOptions = {}): Promise<void> {
  await runWriteTask(
    "Eres un escritor de blogs experto. Crea posts bien estructurados con introducción atractiva, secciones claras y conclusión. Usa Markdown con encabezados, listas y negritas para mejorar la legibilidad.",
    `Escribe un post de blog completo sobre: "${title}". Incluye: título atractivo, introducción, 3-5 secciones con subtítulos, ejemplos o estadísticas relevantes, y conclusión.`,
    "blog",
    opts,
  );
}

export async function rewriteCommand(content: string, opts: WriteOptions & { tone?: string } = {}): Promise<void> {
  const tone = opts.tone ?? "profesional";
  await runWriteTask(
    `Eres un editor experto. Reescribe el texto proporcionado con tono ${tone}, mejorando la claridad, fluidez y estructura sin cambiar el significado principal.`,
    `Reescribe el siguiente texto con tono ${tone}:\n\n${content}`,
    "rewrite",
    opts,
  );
}

export async function analyzeCommand(content: string, opts: WriteOptions = {}): Promise<void> {
  await runWriteTask(
    "Eres un analista experto. Realiza un análisis profundo y detallado del contenido proporcionado, identificando temas principales, argumentos, puntos débiles y fuertes.",
    `Analiza en profundidad el siguiente contenido:\n\n${content}`,
    "analyze_deep",
    opts,
  );
}

export async function translateCommand(content: string, targetLang: string, opts: WriteOptions = {}): Promise<void> {
  await runWriteTask(
    `Eres un traductor profesional experto. Traduce el texto manteniendo el tono, estilo y significado original.`,
    `Traduce el siguiente texto al ${targetLang}:\n\n${content}`,
    "rewrite",
    opts,
  );
}
