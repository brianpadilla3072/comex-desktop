import { spawn, type ChildProcess } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { specialistDirectory } from "../store.js";
import type { ServerConfig } from "../../types.js";

export const TAVILY_CLI_VERSION = "0.2.1";
type Config = Pick<ServerConfig, "configPath">;
const jobs = new Map<string, Promise<void>>();
const logins = new Map<string, { child: ChildProcess; url?: string; error?: string }>();
export const tavilyHome = (config: Config) => join(specialistDirectory(config), "integrations", "tavily-account");
const environment = (config: Config) => ({ ...process.env, HOME: tavilyHome(config), USERPROFILE: tavilyHome(config), PYTHONUNBUFFERED: "1", NO_COLOR: "1" });
export function managedTavilyCli(config: Config) {
  return join(specialistDirectory(config), "integrations", "tavily-cli", process.platform === "win32" ? "Scripts/tvly.exe" : "bin/tvly");
}
export async function tavilyCli(config: Config): Promise<string> {
  if (process.env.OPENWORK_TAVILY_CLI) return process.env.OPENWORK_TAVILY_CLI;
  const managed = managedTavilyCli(config);
  try { await access(managed); return managed; } catch { return "tvly"; }
}

/** No shell, bounded output, no raw CLI error text (which may include credentials). */
export async function runTavilyCommand(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; timeout?: number; signal?: AbortSignal; input?: string } = {}) {
  return new Promise<{ code: number; stdout: string }>((resolve, reject) => {
    const child = spawn(file, args, { env: options.env, cwd: options.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let output = ""; let bytes = 0; let settled = false;
    const finish = (error?: Error, code = 1) => {
      if (settled) return; settled = true;
      clearTimeout(timer); options.signal?.removeEventListener("abort", abort);
      if (error) { child.kill(); reject(error); } else resolve({ code, stdout: output });
    };
    const abort = () => finish(new Error("Se canceló la operación de Tavily."));
    const timer = setTimeout(() => finish(new Error("Tavily no respondió a tiempo. Volvé a intentar.")), options.timeout ?? 30_000);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.on("error", () => finish(new Error("La herramienta de Tavily no está disponible. Preparala desde Herramientas y fuentes.")));
    child.stdout.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 8_000_000) finish(new Error("La respuesta de Tavily superó el límite. Reducí la consulta.")); else output += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 8_000_000) finish(new Error("Tavily superó el límite de salida.")); });
    child.on("close", code => finish(undefined, code ?? 1));
    child.stdin.on("error", () => undefined);
    child.stdin.end(options.input);
  });
}

export async function tavilyStatus(config: Config) {
  const pending = logins.get(tavilyHome(config));
  try {
    const result = await runTavilyCommand(await tavilyCli(config), ["--status", "--json"], { env: environment(config), timeout: 12_000 });
    const value = z.object({ version: z.string(), authenticated: z.boolean() }).safeParse(JSON.parse(result.stdout));
    if (result.code !== 0 || !value.success) throw new Error();
    return { installed: true, ...value.data, loginPending: !!pending && !pending.error, error: pending?.error ?? null };
  } catch { return { installed: false, authenticated: false, loginPending: false, error: "Prepará Tavily para conectar tu cuenta." }; }
}

export async function installTavily(config: Config) {
  const root = join(specialistDirectory(config), "integrations");
  let pending = jobs.get(root);
  if (!pending) {
    pending = (async () => {
      if ((await tavilyStatus(config)).installed) return;
      await mkdir(root, { recursive: true, mode: 0o700 });
      const python = process.env.OPENWORK_INTEGRATIONS_PYTHON ?? (process.platform === "win32" ? "python" : "python3");
      const directory = join(root, "tavily-cli");
      const setup = await runTavilyCommand(python, ["-m", "venv", directory], { timeout: 60_000 });
      if (setup.code !== 0) throw new ApiError(422, "tavily_python_missing", "No se pudo preparar Tavily. Instalá Python 3.10 o posterior con soporte para entornos virtuales y volvé a intentar.");
      const executable = join(directory, process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
      const install = await runTavilyCommand(executable, ["-m", "pip", "install", "--disable-pip-version-check", `tavily-cli==${TAVILY_CLI_VERSION}`], { timeout: 180_000 });
      if (install.code !== 0) throw new ApiError(502, "tavily_install_failed", "No se pudo descargar Tavily. Revisá la conexión y volvé a intentar.");
      if (!(await tavilyStatus(config)).installed) throw new Error("No se pudo verificar Tavily después de instalarlo.");
    })();
    jobs.set(root, pending);
  }
  try { await pending; } finally { if (jobs.get(root) === pending) jobs.delete(root); }
  return tavilyStatus(config);
}

export async function startTavilyLogin(config: Config) {
  const key = tavilyHome(config);
  const previous = logins.get(key);
  if (previous?.url && !previous.error) return { authorizationUrl: previous.url };
  if (previous && !previous.error) throw new ApiError(409, "login_pending", "El inicio de sesión ya está en curso. Volvé a intentar en unos segundos.");
  await mkdir(key, { recursive: true, mode: 0o700 });
  const child = spawn(await tavilyCli(config), ["login", "--no-browser", "--json"], { env: environment(config), stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  const state: { child: ChildProcess; url?: string; error?: string } = { child };
  logins.set(key, state);
  return new Promise<{ authorizationUrl: string }>((resolve, reject) => {
    let buffer = ""; let complete = false;
    const fail = () => { state.error = "No se pudo completar el acceso a Tavily. Conectá la cuenta de nuevo."; if (!complete) { complete = true; clearTimeout(timer); reject(new ApiError(502, "tavily_login_failed", state.error)); } };
    const timer = setTimeout(() => { child.kill(); fail(); }, 30_000);
    const lifetime = setTimeout(() => { child.kill(); fail(); }, 10 * 60_000); lifetime.unref?.();
    child.on("error", fail);
    child.on("close", code => { clearTimeout(lifetime); if (code === 0) logins.delete(key); else fail(); });
    child.stdout?.resume();
    child.stderr?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      if (buffer.length > 64_000) { child.kill(); fail(); return; }
      const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const event = z.object({ event: z.literal("authorization_required"), authorization_url: z.string().url() }).parse(JSON.parse(line));
          const url = new URL(event.authorization_url);
          if (url.protocol !== "https:" || !["mcp.tavily.com", "app.tavily.com", "auth.tavily.com"].includes(url.hostname) || url.username || url.password) throw new Error();
          state.url = url.href;
          if (!complete) { complete = true; clearTimeout(timer); resolve({ authorizationUrl: state.url }); }
        } catch { /* Non-event diagnostic output is intentionally discarded. */ }
      }
    });
  });
}

export async function saveTavilyKey(config: Config, apiKey: string) {
  if (!/^tvly-[A-Za-z0-9_-]{10,250}$/.test(apiKey)) throw new ApiError(422, "invalid_tavily_key", "Revisá la clave de Tavily.");
  await mkdir(tavilyHome(config), { recursive: true, mode: 0o700 });
  const cli = await tavilyCli(config);
  // Use the CLI's own credential store. Pass the secret over stdin, never argv.
  const python = join(cli, "..", process.platform === "win32" ? "python.exe" : "python");
  const result = await runTavilyCommand(python, ["-c", "import sys; from tavily_cli.config import save_api_key; save_api_key(sys.stdin.read())"], { env: environment(config), input: apiKey });
  if (result.code !== 0) throw new ApiError(502, "tavily_key_failed", "No se pudo guardar la conexión a Tavily.");
  return tavilyStatus(config);
}

export async function disconnectTavily(config: Config) {
  const pending = logins.get(tavilyHome(config)); pending?.child.kill(); logins.delete(tavilyHome(config));
  const result = await runTavilyCommand(await tavilyCli(config), ["logout", "--json"], { env: environment(config) });
  if (result.code !== 0) throw new ApiError(502, "tavily_logout_failed", "No se pudo desconectar Tavily. Volvé a intentar.");
  return tavilyStatus(config);
}

export async function testTavily(config: Config) {
  const result = await runTavilyCommand(await tavilyCli(config), ["search", "Tavily official documentation", "--client-name", "opencode", "--max-results", "1", "--json"], { env: environment(config), timeout: 45_000 });
  if (result.code !== 0) throw new ApiError(result.code === 3 ? 401 : 502, "tavily_search_failed", result.code === 3 ? "Conectá tu cuenta de Tavily para buscar." : "Tavily no pudo completar la búsqueda. Revisá el saldo o volvé a intentar.");
  const value = z.object({ results: z.array(z.object({ title: z.string(), url: z.string().url() })) }).parse(JSON.parse(result.stdout));
  return { verifiedAt: new Date().toISOString(), sources: value.results.map(({ title, url }) => ({ title, url })) };
}
