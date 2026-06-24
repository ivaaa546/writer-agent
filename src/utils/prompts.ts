import { select as inquirerSelect, input as inquirerInput } from "@inquirer/prompts";

/**
 * Binds the Escape key to emit a Ctrl+C event, which forces Inquirer to exit.
 * Returns a cleanup function to unbind the listener.
 */
function bindEsc() {
  const handler = (ch: any, key: any) => {
    if (key && key.name === 'escape') {
      process.stdin.emit('keypress', '\\x03', { sequence: '\\x03', name: 'c', ctrl: true, meta: false, shift: false });
    }
  };
  process.stdin.on('keypress', handler);
  return () => process.stdin.off('keypress', handler);
}

/**
 * Wrapper for inquirer's select that supports canceling via Esc or Ctrl+C.
 * Returns "cancel" if aborted.
 */
export async function select(options: Parameters<typeof inquirerSelect>[0]): Promise<any> {
  const unbind = bindEsc();
  try {
    return await inquirerSelect(options);
  } catch (err: any) {
    if (err.name === 'ExitPromptError' || err.message?.includes("User force closed")) {
      return "cancel";
    }
    throw err;
  } finally {
    unbind();
  }
}

/**
 * Wrapper for inquirer's input that supports canceling via Esc or Ctrl+C.
 * Returns "" (empty string) if aborted.
 */
export async function input(options: Parameters<typeof inquirerInput>[0]): Promise<string> {
  const unbind = bindEsc();
  try {
    return await inquirerInput(options);
  } catch (err: any) {
    if (err.name === 'ExitPromptError' || err.message?.includes("User force closed")) {
      return "";
    }
    throw err;
  } finally {
    unbind();
  }
}
