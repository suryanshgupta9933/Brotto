import { spawn, exec as execCb } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execCb);

export interface OllamaFixture {
  url: string;
  cleanup: () => Promise<void>;
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

export async function startOllama(
  model = process.env.E2E_MODEL ?? "qwen2.5:3b",
): Promise<OllamaFixture> {
  const binary = process.env.OLLAMA_BINARY ?? "ollama";
  const host = "127.0.0.1:11434";
  const proc = spawn(binary, ["serve"], { stdio: "pipe", env: { ...process.env, OLLAMA_HOST: host } });
  proc.stderr?.on("data", (chunk) => process.stderr.write(`[ollama] ${chunk}`));

  try {
    await waitForUrl(`http://${host}/api/tags`, 30_000);
  } catch (err) {
    proc.kill("SIGTERM");
    throw err;
  }

  // Pull model if missing
  try {
    await exec(`${binary} pull ${model}`, { env: { ...process.env, OLLAMA_HOST: host }, timeout: 600_000 });
  } catch (err) {
    proc.kill("SIGTERM");
    throw new Error(`Failed to pull model ${model}: ${(err as Error).message}`);
  }

  return {
    url: `http://${host}/v1`,
    cleanup: async () => {
      proc.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1000));
    },
  };
}

export async function isOllamaAvailable(): Promise<boolean> {
  try {
    const res = await fetch("http://127.0.0.1:11434/api/tags");
    return res.ok;
  } catch {
    return false;
  }
}
