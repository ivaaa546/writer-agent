/**
 * `writer model` — Configure the model for the active AI provider.
 */

import chalk from "chalk";
import { getActiveProvider, getConfig, setConfig } from "../auth/auth-manager.js";
import { getProviderById } from "../providers/router.js";
import { select, input } from "../utils/prompts.js";

export async function modelCommand(): Promise<void> {
  const activeId = getActiveProvider();
  
  console.log(chalk.bold.magenta(`\n✦ Configuración de Modelos para '${activeId}'\n`));

  let provider;
  try {
    provider = await getProviderById(activeId);
  } catch (err) {
    console.error(chalk.red(`✗ Error al cargar proveedor ${activeId}: ${err instanceof Error ? err.message : String(err)}`));
    console.log(chalk.gray(`Asegúrate de haber iniciado sesión con: writer login ${activeId}\n`));
    process.exit(1);
  }

  // Fetch available models using the provider's API if supported
  console.log(chalk.gray("Obteniendo modelos disponibles..."));
  const availableModels = await provider.listModels();
  
  const currentLight = getConfig(`provider:${activeId}:model_light`) || "(default)";
  const currentHeavy = getConfig(`provider:${activeId}:model_heavy`) || "(default)";

  const tier = await select({
    message: "¿Qué tipo de modelo deseas configurar?",
    choices: [
      { name: `Modelo Rápido / Light (actual: ${currentLight})`, value: "light" },
      { name: `Modelo Inteligente / Heavy (actual: ${currentHeavy})`, value: "heavy" },
      { name: "Cancelar", value: "cancel" },
    ],
  });

  if (tier === "cancel") return;

  const configKey = `provider:${activeId}:model_${tier}`;

  // If the provider returned a list of models, let the user select one
  let selectedModel = "";
  if (availableModels.length > 0) {
    const choices = availableModels.map(m => ({ name: m, value: m }));
    choices.push({ name: "Ingresar manualmente...", value: "manual" });
    choices.push({ name: "Restaurar por defecto", value: "default" });

    selectedModel = await select({
      message: `Selecciona el modelo para tareas ${tier === "light" ? "rápidas" : "complejas"}:`,
      choices,
    });
  } else {
    selectedModel = "manual";
  }

  if (selectedModel === "manual") {
    selectedModel = await input({
      message: "Ingresa el nombre exacto del modelo:",
    });
  }

  if (selectedModel === "default" || selectedModel.trim() === "") {
    // We clear it by setting it to empty, or deleting it
    setConfig(configKey, "");
    console.log(chalk.green(`✓ Modelo ${tier} restaurado al valor por defecto.`));
  } else {
    setConfig(configKey, selectedModel.trim());
    console.log(chalk.green(`✓ Modelo ${tier} configurado a: ${chalk.bold(selectedModel.trim())}`));
  }
  console.log();
}
