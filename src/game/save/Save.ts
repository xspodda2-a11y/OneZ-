/** Save slots in IndexedDB with a localStorage fallback. */

const DB_NAME = 'winds-of-eternity';
const STORE = 'saves';
const SETTINGS_KEY = 'woe.settings';

export interface SaveMeta {
  slot: number;
  time: number;
  level: number;
  gold: number;
  location: string;
  playTime: number;
  quest: string;
}

export class SaveSystem {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    try {
      this.db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'slot' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch (e) {
      console.warn('IndexedDB unavailable, using localStorage', e);
      this.db = null;
    }
  }

  async save(slot: number, data: any): Promise<void> {
    await this.open();
    const record = { slot, data, time: Date.now() };
    if (this.db) {
      await new Promise<void>((resolve, reject) => {
        const tx = this.db!.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } else {
      localStorage.setItem(`${DB_NAME}.${slot}`, JSON.stringify(record));
    }
  }

  async load(slot: number): Promise<any | null> {
    await this.open();
    if (this.db) {
      return await new Promise<any>((resolve) => {
        const tx = this.db!.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(slot);
        req.onsuccess = () => resolve(req.result?.data ?? null);
        req.onerror = () => resolve(null);
      });
    }
    const raw = localStorage.getItem(`${DB_NAME}.${slot}`);
    return raw ? JSON.parse(raw).data : null;
  }

  async list(): Promise<(SaveMeta | null)[]> {
    await this.open();
    const out: (SaveMeta | null)[] = [null, null, null];
    for (let i = 0; i < 3; i++) {
      const d = await this.load(i);
      if (d) out[i] = d.meta ?? null;
    }
    return out;
  }

  async remove(slot: number): Promise<void> {
    await this.open();
    if (this.db) {
      await new Promise<void>((resolve) => {
        const tx = this.db!.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(slot);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    localStorage.removeItem(`${DB_NAME}.${slot}`);
  }

  saveSettings(s: any) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }

  loadSettings(): any | null {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
}

export const saves = new SaveSystem();
