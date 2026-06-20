/**
 * Generic Device Code Flow polling helper.
 * Used by GitHub Copilot and OpenAI Codex device flows.
 */

type PollResult<T> =
  | { status: "complete"; value: T }
  | { status: "pending" }
  | { status: "slow_down" }
  | { status: "failed"; message: string };

interface PollOptions<T> {
  intervalSeconds?: number;
  expiresInSeconds?: number;
  signal?: AbortSignal;
  poll: () => Promise<PollResult<T>>;
}

export async function pollOAuthDeviceCodeFlow<T>(options: PollOptions<T>): Promise<T> {
  const intervalMs = (options.intervalSeconds ?? 5) * 1000;
  const expiresMs = (options.expiresInSeconds ?? 600) * 1000;
  const startedAt = Date.now();
  let currentInterval = intervalMs;

  while (true) {
    if (options.signal?.aborted) {
      throw new Error("Login cancelled");
    }

    if (Date.now() - startedAt > expiresMs) {
      throw new Error("Device code expired. Please try again.");
    }

    await sleep(currentInterval, options.signal);

    if (options.signal?.aborted) {
      throw new Error("Login cancelled");
    }

    const result = await options.poll();

    switch (result.status) {
      case "complete":
        return result.value;
      case "pending":
        // Reset interval to normal
        currentInterval = intervalMs;
        break;
      case "slow_down":
        // Back off by 5 extra seconds
        currentInterval = currentInterval + 5000;
        break;
      case "failed":
        throw new Error(result.message);
    }
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("Login cancelled"));
    });
  });
}
