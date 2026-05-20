import type { LabelAnalysis } from './ttb';

export type ReviewItemRecord = {
  id: string;
  batchId: string;
  projectId: string;
  sourceFilename: string;
  name: string;
  status: 'queued' | 'uploading' | 'done' | 'error';
  preview: string;
  imageDataUrl: string;
  mimeType: string;
  analysis?: LabelAnalysis;
  originalAnalysis?: LabelAnalysis;
  applicationFacts?: Record<string, string>;
  reviewMeta?: {
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
  };
  checkOverrides?: Record<string, LabelAnalysis['status']>;
  error?: string;
};

export type PersistedSession = {
  codexApiKey: string;
  outputFormat: 'json' | 'csv';
  currentProjectId: string;
  projects: Array<{
    id: string;
    name: string;
  }>;
  items: ReviewItemRecord[];
};

const DB_NAME = 'ttb-label-verifier';
const DB_VERSION = 1;
const STORE_NAME = 'session';
const SESSION_KEY = 'current';

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onerror = () => reject(request.error ?? new Error('Failed to open session database.'));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function loadSession(): Promise<PersistedSession | null> {
  try {
    const db = await openDatabase();
    return await new Promise<PersistedSession | null>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(SESSION_KEY);

      request.onerror = () => reject(request.error ?? new Error('Failed to load session.'));
      request.onsuccess = () => resolve((request.result as PersistedSession | undefined) ?? null);
      transaction.oncomplete = () => db.close();
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to load session.'));
    });
  } catch {
    return null;
  }
}

export async function saveSession(session: PersistedSession) {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(session, SESSION_KEY);

      request.onerror = () => reject(request.error ?? new Error('Failed to save session.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to save session.'));
    });
    db.close();
  } catch {
    return;
  }
}

export async function clearSession() {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(SESSION_KEY);

      request.onerror = () => reject(request.error ?? new Error('Failed to clear session.'));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Failed to clear session.'));
    });
    db.close();
  } catch {
    return;
  }
}
