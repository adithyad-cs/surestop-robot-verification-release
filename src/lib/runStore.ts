// Per-browser run history (IndexedDB). Kept separate from the recorded reference dataset.
//
// Version 2 (stage 4) adds two stores next to "runs", which is kept as it was:
//   failures  one LabFailure per failed mission (never scored, never in "runs")
//   batches   one LabBatch per batch, keyed by batchId, rewritten as the batch progresses
// Opening a version-1 database upgrades it in place; its runs stay. Runs stored before version 2
// have no labBatchId, and failures of the batches that produced them were never stored.
import type { RunRecord } from "@/experiments/engine";
import type { LabBatch, LabFailure } from "@/lab/batchRecords";

const DB = "surestop";
const VERSION = 2;
const RUNS = "runs";
const FAILURES = "failures";
const BATCHES = "batches";
type StoreName = typeof RUNS | typeof FAILURES | typeof BATCHES;

/** A run stored by the Lab. labBatchId links it to its LabBatch (absent on runs stored before stage 4). */
export type StoredRun = RunRecord & { labBatchId?: string };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RUNS)) db.createObjectStore(RUNS, { autoIncrement: true });
      if (!db.objectStoreNames.contains(FAILURES)) db.createObjectStore(FAILURES, { autoIncrement: true });
      if (!db.objectStoreNames.contains(BATCHES)) db.createObjectStore(BATCHES, { keyPath: "batchId" });
    };
    req.onsuccess = () => {
      // Let another tab upgrade the database instead of blocking it.
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error);
  });
}

/** One transaction over `stores`; resolves when it has committed. */
async function write(stores: StoreName[], fn: (t: IDBTransaction) => void): Promise<void> {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const t = db.transaction(stores, "readwrite");
    fn(t);
    t.oncomplete = () => {
      db.close();
      resolve();
    };
    t.onerror = () => reject(t.error);
    t.onabort = () => {
      db.close();
      reject(t.error ?? new Error("IndexedDB transaction aborted"));
    };
  });
}

async function getAll<T>(store: StoreName): Promise<T[]> {
  const db = await open();
  return new Promise<T[]>((resolve, reject) => {
    const t = db.transaction(store, "readonly");
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve((req.result as T[]) ?? []);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

// Writes return false when storage is unavailable (private mode, quota); the Lab then keeps the
// records for this page only and says so.

/** Stores a completed run and its batch's updated counters in one transaction. */
export async function saveRun(r: StoredRun, batch?: LabBatch): Promise<boolean> {
  try {
    await write(batch ? [RUNS, BATCHES] : [RUNS], (t) => {
      t.objectStore(RUNS).add(r);
      if (batch) t.objectStore(BATCHES).put(batch);
    });
    return true;
  } catch {
    return false;
  }
}

/** Stores a failed mission and its batch's updated counters in one transaction. */
export async function saveFailure(f: LabFailure, batch: LabBatch): Promise<boolean> {
  try {
    await write([FAILURES, BATCHES], (t) => {
      t.objectStore(FAILURES).add(f);
      t.objectStore(BATCHES).put(batch);
    });
    return true;
  } catch {
    return false;
  }
}

export async function saveBatch(b: LabBatch): Promise<boolean> {
  try {
    await write([BATCHES], (t) => t.objectStore(BATCHES).put(b));
    return true;
  } catch {
    return false;
  }
}

export async function loadRuns(): Promise<StoredRun[]> {
  try {
    return await getAll<StoredRun>(RUNS);
  } catch {
    return [];
  }
}

export async function loadFailures(): Promise<LabFailure[]> {
  try {
    return await getAll<LabFailure>(FAILURES);
  } catch {
    return [];
  }
}

export async function loadBatches(): Promise<LabBatch[]> {
  try {
    return await getAll<LabBatch>(BATCHES);
  } catch {
    return [];
  }
}

/** Deletes the runs, failures and batch records stored in this browser. */
export async function clearRuns(): Promise<void> {
  try {
    await write([RUNS, FAILURES, BATCHES], (t) => {
      t.objectStore(RUNS).clear();
      t.objectStore(FAILURES).clear();
      t.objectStore(BATCHES).clear();
    });
  } catch {
    /* ignore */
  }
}
