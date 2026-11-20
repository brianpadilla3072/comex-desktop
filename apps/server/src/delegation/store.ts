import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { DELEGATE_STORE_VERSION, delegateStore, type DelegateStore, type StoredDelegate } from "./schema.js";

/**
 * Registered delegate recipes, one JSON file per OpenWork installation:
 * `<runtime storage>/delegates/recipes.json` (`delegateStore`, version 1).
 * Recipes describe programs on this computer, so they apply to every project.
 * Writes are serialized through one queue per file (R7).
 */

export function delegateStorePath(runtimeDir: string): string {
  return join(runtimeDir, "delegates", "recipes.json");
}

const emptyStore = (): DelegateStore => ({ version: DELEGATE_STORE_VERSION, agents: {} });

export async function readDelegateStore(path: string): Promise<DelegateStore> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return emptyStore();
  }
  let parsed: ReturnType<typeof delegateStore.safeParse>;
  try {
    parsed = delegateStore.safeParse(JSON.parse(text));
  } catch {
    parsed = delegateStore.safeParse(null);
  }
  // An unreadable file is kept on disk for the person to inspect, never overwritten silently.
  if (!parsed.success) throw new Error(`The delegate recipes file ${path} is not valid. Fix or remove it.`);
  return parsed.data;
}

// Owner: this module; lifetime: the process. One pending write chain per file path.
const writeQueues = new Map<string, Promise<unknown>>();

export function updateDelegateStore(path: string, update: (current: DelegateStore) => DelegateStore): Promise<DelegateStore> {
  const job = async () => {
    const next = delegateStore.parse(update(await readDelegateStore(path)));
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, path);
    return next;
  };
  const previous = writeQueues.get(path) ?? Promise.resolve();
  const next = previous.then(job, job);
  writeQueues.set(path, next.catch(() => undefined));
  return next;
}

export function putDelegate(path: string, entry: StoredDelegate): Promise<DelegateStore> {
  return updateDelegateStore(path, (current) => ({ ...current, agents: { ...current.agents, [entry.recipe.name]: entry } }));
}

export function removeDelegate(path: string, name: string): Promise<DelegateStore> {
  return updateDelegateStore(path, (current) => {
    const agents = { ...current.agents };
    delete agents[name];
    return { ...current, agents };
  });
}
