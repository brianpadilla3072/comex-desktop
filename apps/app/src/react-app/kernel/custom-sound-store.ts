/**
 * A person-uploaded completion sound lives in IndexedDB, never in localStorage
 * (small quota) and never on disk outside the renderer. The preference only
 * stores which sound is selected.
 */
const DB_NAME = "openwork-media";
const DB_VERSION = 1;
const STORE = "sounds";
const TASK_COMPLETE_KEY = "task-complete";

export const MAX_CUSTOM_SOUND_BYTES = 2 * 1024 * 1024;

export type CustomTaskSound = {
  name: string;
  type: string;
  blob: Blob;
  updatedAt: number;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveCustomTaskSound(file: File): Promise<CustomTaskSound> {
  const entry: CustomTaskSound = { name: file.name, type: file.type, blob: file, updatedAt: Date.now() };
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(entry, TASK_COMPLETE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  return entry;
}

export async function loadCustomTaskSound(): Promise<CustomTaskSound | null> {
  let db: IDBDatabase;
  try {
    db = await openDatabase();
  } catch {
    return null;
  }
  try {
    return await new Promise<CustomTaskSound | null>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const request = tx.objectStore(STORE).get(TASK_COMPLETE_KEY);
      request.onsuccess = () => {
        const value: unknown = request.result;
        if (!value || typeof value !== "object") {
          resolve(null);
          return;
        }
        const name = Reflect.get(value, "name");
        const type = Reflect.get(value, "type");
        const blob = Reflect.get(value, "blob");
        const updatedAt = Reflect.get(value, "updatedAt");
        if (typeof name !== "string" || !(blob instanceof Blob)) {
          resolve(null);
          return;
        }
        resolve({
          name,
          type: typeof type === "string" ? type : "audio/*",
          blob,
          updatedAt: typeof updatedAt === "number" ? updatedAt : 0,
        });
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}
