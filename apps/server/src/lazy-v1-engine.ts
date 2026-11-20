/**
 * On-demand OpenCode v1 engine (feature `lazyV1Engine`).
 *
 * While OpenCode v2 serves chats, the v1 process only answers occasional
 * reads (old chats, provider sign-in, MCP status), yet it used to run for the
 * whole session at ~440 MB. This module keeps v1's address alive without the
 * process: a loopback TCP gate listens on the stable v1 URL, starts the engine
 * on the first connection (one start at a time, shared by every waiter), and
 * pipes bytes both ways. Every v1 consumer keeps its URL and credentials, so
 * nothing above has to know whether the process runs.
 *
 * After `idleMs` without traffic, and once the engine itself reports no
 * running session or pending request, the process is stopped. The next
 * connection starts it again. Idle stop only applies while the caller says so
 * (v2 is the chat engine); otherwise a stopped engine is started again by the
 * sweep, so v1 as the chat engine is always running.
 *
 * Internal watchers that hold a stream open (thread-approval replay) use
 * `directUrl()` so they never count as traffic and never wake the engine.
 */
import net from "node:net";
import type { ManagedOpencodeServer, OpencodeExecutionSnapshot } from "./managed-opencode.js";
import type { ServerConfig } from "./types.js";

export type LazyEngineState = "stopped" | "starting" | "running" | "stopping";

export type LazyEngineLogger = {
  log: (level: "info" | "warn" | "error", message: string, attributes?: Record<string, unknown>) => void;
};

export type LazyEngineOptions = {
  hostname?: string;
  /** Ports the gate must not take (the OpenWork server's own port). */
  excludedPorts?: number[];
  /** Fixed Basic auth credentials every process of this engine is started with. */
  credentials: { username: string; password: string };
  /** Start one engine process with `credentials`. */
  spawn: (credentials: { username: string; password: string }) => Promise<ManagedOpencodeServer>;
  /**
   * Work a fresh process needs before it serves traffic, against its direct
   * URL (for example seeding provider credentials). Failures are logged; the
   * engine still serves.
   */
  prepare?: (process: ManagedOpencodeServer) => Promise<void>;
  /** After the process serves traffic (registry, trust, MCP push). Not awaited by traffic. */
  onStarted?: (process: ManagedOpencodeServer) => Promise<void> | void;
  /** After the process stopped, for any reason. */
  onStopped?: (process: ManagedOpencodeServer) => Promise<void> | void;
  /** Once, after `close()` released the gate and the process. */
  onClosed?: () => void;
  /** Quiet period before an idle stop. 0 disables idle stop. */
  idleMs: number;
  /** Whether idle stop applies now. When false, a stopped engine is started again. */
  idleStopAllowed?: () => boolean;
  /**
   * Direct probe of the running process for unfinished work. True, or a
   * thrown error (unknown), keeps the engine running.
   */
  busy?: (process: ManagedOpencodeServer) => Promise<boolean>;
  /** How often the idle check runs. Defaults to min(idleMs, 60 s). */
  sweepMs?: number;
  /** Shown in diagnostics before the first start. */
  execution: OpencodeExecutionSnapshot;
  now?: () => number;
  logger?: LazyEngineLogger;
};

export type LazyEngineStatus = {
  state: LazyEngineState;
  pid: number | null;
  starts: number;
  stops: number;
  lastStartedAt: number | null;
  lastStoppedAt: number | null;
  lastError: string | null;
  idleMs: number;
};

export type LazyEngine = ManagedOpencodeServer & {
  dormant: () => boolean;
  /** Start the process if needed; resolves once it serves traffic. */
  ensureStarted: () => Promise<void>;
  state: () => LazyEngineState;
  status: () => LazyEngineStatus;
  /** The running process's own URL, bypassing the gate. Null while stopped. */
  directUrl: () => string | null;
  /** Run the idle check now. Resolves true when it stopped the process. */
  stopIfIdle: () => Promise<boolean>;
};

type Connection = { client: net.Socket; upstream: net.Socket | null; lastActivityAt: number };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listenOnFreePort(server: net.Server, hostname: string, excluded: Set<number>): Promise<number> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const port = await new Promise<number>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, hostname, () => {
        server.removeListener("error", onError);
        const address = server.address();
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("The engine gate has no port"));
      });
    });
    if (!excluded.has(port)) return port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  throw new Error("Failed to find a free port for the engine gate");
}

export async function createLazyEngine(options: LazyEngineOptions): Promise<LazyEngine> {
  const hostname = options.hostname ?? "127.0.0.1";
  const now = options.now ?? Date.now;
  const connections = new Set<Connection>();
  let state: LazyEngineState = "stopped";
  let current: ManagedOpencodeServer | null = null;
  let startPromise: Promise<ManagedOpencodeServer> | null = null;
  let stopPromise: Promise<void> | null = null;
  let closed = false;
  let closePromise: Promise<void> | null = null;
  let lastActivityAt = now();
  let starts = 0;
  let stops = 0;
  let lastStartedAt: number | null = null;
  let lastStoppedAt: number | null = null;
  let lastError: string | null = null;
  let sweeping = false;

  const touch = (connection?: Connection) => {
    const at = now();
    lastActivityAt = at;
    if (connection) connection.lastActivityAt = at;
  };

  const dropConnection = (connection: Connection) => {
    if (!connections.delete(connection)) return;
    connection.client.destroy();
    connection.upstream?.destroy();
    touch();
  };

  const notifyStopped = async (process: ManagedOpencodeServer) => {
    stops += 1;
    lastStoppedAt = now();
    try {
      await options.onStopped?.(process);
    } catch (error) {
      options.logger?.log("warn", "Engine v1 stop bookkeeping failed.", { "error.message": errorMessage(error) });
    }
  };

  const watchExit = (process: ManagedOpencodeServer) => {
    // The managed handle has no exit event; poll its liveness cheaply. An
    // engine that died on its own is reported stopped, and the next
    // connection starts a new one.
    const timer = setInterval(() => {
      if (current !== process) {
        clearInterval(timer);
        return;
      }
      if (process.isAlive()) return;
      clearInterval(timer);
      current = null;
      state = "stopped";
      lastError = "Engine v1 exited";
      options.logger?.log("warn", "Engine v1 exited on its own; it starts again on demand.");
      void notifyStopped(process);
    }, 1_000);
    timer.unref?.();
  };

  const start = async (): Promise<ManagedOpencodeServer> => {
    if (stopPromise) await stopPromise;
    if (closed) throw new Error("Engine v1 is shut down");
    if (current && state === "running" && current.isAlive()) return current;
    state = "starting";
    let process: ManagedOpencodeServer;
    try {
      process = await options.spawn(options.credentials);
    } catch (error) {
      state = "stopped";
      lastError = errorMessage(error);
      options.logger?.log("error", "Engine v1 failed to start on demand.", { "error.message": lastError });
      throw error;
    }
    if (closed) {
      await process.close().catch(() => undefined);
      state = "stopped";
      throw new Error("Engine v1 is shut down");
    }
    if (options.prepare) {
      await options.prepare(process).catch((error: unknown) => {
        options.logger?.log("warn", "Engine v1 started without its prepared state.", { "error.message": errorMessage(error) });
      });
    }
    current = process;
    state = "running";
    starts += 1;
    lastStartedAt = now();
    lastError = null;
    touch();
    watchExit(process);
    options.logger?.log("info", "Engine v1 started on demand.", { "engine.pid": process.pid ?? "unknown", "engine.starts": starts });
    try {
      await options.onStarted?.(process);
    } catch (error) {
      options.logger?.log("warn", "Engine v1 start bookkeeping failed.", { "error.message": errorMessage(error) });
    }
    return process;
  };

  const ensureProcess = (): Promise<ManagedOpencodeServer> => {
    if (closed) return Promise.reject(new Error("Engine v1 is shut down"));
    if (current && state === "running" && current.isAlive()) return Promise.resolve(current);
    startPromise ??= start().finally(() => {
      startPromise = null;
    });
    return startPromise;
  };

  const stopProcess = (reason: "idle" | "shutdown"): Promise<void> => {
    stopPromise ??= (async () => {
      const process = current;
      if (!process) return;
      state = "stopping";
      for (const connection of [...connections]) dropConnection(connection);
      try {
        await process.close();
      } finally {
        if (current === process) current = null;
        state = "stopped";
        options.logger?.log("info", reason === "idle" ? "Engine v1 stopped after being idle." : "Engine v1 stopped.");
        await notifyStopped(process);
      }
    })().finally(() => {
      stopPromise = null;
    });
    return stopPromise;
  };

  const gate = net.createServer({ pauseOnConnect: true }, (client) => {
    const connection: Connection = { client, upstream: null, lastActivityAt: now() };
    connections.add(connection);
    touch(connection);
    client.on("error", () => dropConnection(connection));
    client.on("close", () => dropConnection(connection));
    ensureProcess().then((process) => {
      if (!connections.has(connection)) return;
      const target = new URL(process.url);
      const upstream = net.connect(Number(target.port), target.hostname);
      connection.upstream = upstream;
      upstream.on("error", () => dropConnection(connection));
      upstream.on("close", () => dropConnection(connection));
      upstream.once("connect", () => {
        // Pipe first: a "data" listener alone would start the paused client
        // flowing and drop what it buffered before the engine was up.
        client.pipe(upstream);
        upstream.pipe(client);
        client.on("data", () => touch(connection));
        upstream.on("data", () => touch(connection));
      });
    }, () => dropConnection(connection));
  });
  const port = await listenOnFreePort(gate, hostname, new Set(options.excludedPorts ?? []));
  const url = `http://${hostname}:${port}`;

  const stopIfIdle = async (): Promise<boolean> => {
    const process = current;
    if (closed || !process || state !== "running" || options.idleMs <= 0) return false;
    if (options.idleStopAllowed && !options.idleStopAllowed()) return false;
    const at = now();
    if (at - lastActivityAt < options.idleMs) return false;
    for (const connection of connections) {
      if (at - connection.lastActivityAt < options.idleMs) return false;
    }
    if (options.busy) {
      try {
        if (await options.busy(process)) return false;
      } catch {
        return false;
      }
    }
    // Traffic that arrived during the probe wins over the idle verdict.
    if (current !== process || state !== "running" || lastActivityAt > at) return false;
    await stopProcess("idle");
    return true;
  };

  const sweep = async () => {
    if (sweeping || closed) return;
    sweeping = true;
    try {
      if (options.idleStopAllowed && !options.idleStopAllowed()) {
        // v1 is the chat engine again: keep it running.
        if (state === "stopped") await ensureProcess().catch(() => undefined);
        return;
      }
      await stopIfIdle();
    } finally {
      sweeping = false;
    }
  };
  const sweepTimer = setInterval(() => void sweep().catch(() => undefined),
    options.sweepMs ?? Math.max(1_000, Math.min(options.idleMs > 0 ? options.idleMs : 60_000, 60_000)));
  sweepTimer.unref?.();

  const close = (): Promise<void> => {
    closePromise ??= (async () => {
      closed = true;
      clearInterval(sweepTimer);
      const gateClosed = new Promise<void>((resolve) => gate.close(() => resolve()));
      for (const connection of [...connections]) dropConnection(connection);
      try {
        if (startPromise) await startPromise.catch(() => undefined);
        await stopProcess("shutdown");
      } finally {
        await gateClosed;
        options.onClosed?.();
      }
    })();
    return closePromise;
  };

  return {
    url,
    username: options.credentials.username,
    password: options.credentials.password,
    get pid() {
      return current?.pid ?? null;
    },
    get execution() {
      return current?.execution ?? options.execution;
    },
    isAlive: () => !closed,
    close,
    // Stopping counts: a background probe arriving then would only restart it.
    dormant: () => (state === "stopped" || state === "stopping") && !closed,
    ensureStarted: async () => {
      await ensureProcess();
    },
    state: () => state,
    status: () => ({
      state,
      pid: current?.pid ?? null,
      starts,
      stops,
      lastStartedAt,
      lastStoppedAt,
      lastError,
      idleMs: options.idleMs,
    }),
    directUrl: () => (state === "running" ? current?.url ?? null : null),
    stopIfIdle,
  };
}

/** Idle period before engine v1 stops; `OPENWORK_V1_ENGINE_IDLE_MS`, default 10 minutes, 0 disables. */
export function lazyV1EngineIdleMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.OPENWORK_V1_ENGINE_IDLE_MS?.trim();
  if (!raw) return 10 * 60_000;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : 10 * 60_000;
}

const lazyEnginesByConfig = new WeakMap<ServerConfig, Set<LazyEngine>>();

export function registerLazyV1Engine(config: ServerConfig, engine: LazyEngine): () => void {
  const engines = lazyEnginesByConfig.get(config) ?? new Set<LazyEngine>();
  engines.add(engine);
  lazyEnginesByConfig.set(config, engines);
  return () => {
    engines.delete(engine);
  };
}

function sameOrigin(left: string, right: string): boolean {
  try {
    return new URL(left).origin === new URL(right).origin;
  } catch {
    return false;
  }
}

/** The on-demand engine serving `baseUrl`, when engine v1 runs on demand. */
export function lazyV1EngineForUrl(config: ServerConfig, baseUrl: string | null | undefined): LazyEngine | null {
  const url = baseUrl?.trim();
  if (!url) return null;
  for (const engine of lazyEnginesByConfig.get(config) ?? []) {
    if (sameOrigin(engine.url, url)) return engine;
  }
  return null;
}

/**
 * True when `baseUrl` is an on-demand engine v1 whose process is not running.
 * Background probes and syncs skip such an engine instead of waking it: with
 * no process there is no running work, and the next start reads current state.
 */
export function v1EngineDormant(config: ServerConfig, baseUrl: string | null | undefined): boolean {
  return lazyV1EngineForUrl(config, baseUrl)?.dormant() === true;
}
