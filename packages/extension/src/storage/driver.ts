/**
 * Storage driver abstraction. The ONLY module allowed to touch chrome.storage /
 * localStorage. Business & UI code go through the typed repositories, never here.
 */
export interface StorageDriver {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  watch<T>(key: string, cb: (value: T | null) => void): () => void;
}

const PREFIX = 'browser-agent:';
const k = (key: string) => `${PREFIX}${key}`;

class ChromeStorageDriver implements StorageDriver {
  async get<T>(key: string): Promise<T | null> {
    const res = await chrome.storage.local.get(k(key));
    return (res[k(key)] as T) ?? null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [k(key)]: value });
  }
  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(k(key));
  }
  watch<T>(key: string, cb: (value: T | null) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== 'local') return;
      if (changes[k(key)]) cb((changes[k(key)].newValue as T) ?? null);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}

class LocalStorageDriver implements StorageDriver {
  private listeners = new Map<string, Set<(v: unknown) => void>>();
  async get<T>(key: string): Promise<T | null> {
    const raw = localStorage.getItem(k(key));
    return raw ? (JSON.parse(raw) as T) : null;
  }
  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(k(key), JSON.stringify(value));
    this.listeners.get(key)?.forEach(cb => cb(value));
  }
  async remove(key: string): Promise<void> {
    localStorage.removeItem(k(key));
    this.listeners.get(key)?.forEach(cb => cb(null));
  }
  watch<T>(key: string, cb: (value: T | null) => void): () => void {
    const set = this.listeners.get(key) ?? new Set();
    set.add(cb as (v: unknown) => void);
    this.listeners.set(key, set);
    const storageHandler = (e: StorageEvent) => {
      if (e.key === k(key)) cb(e.newValue ? (JSON.parse(e.newValue) as T) : null);
    };
    window.addEventListener('storage', storageHandler);
    return () => {
      set.delete(cb as (v: unknown) => void);
      window.removeEventListener('storage', storageHandler);
    };
  }
}

let driver: StorageDriver | null = null;

export function getDriver(): StorageDriver {
  if (driver) return driver;
  const hasChrome = typeof chrome !== 'undefined' && !!chrome.storage?.local;
  driver = hasChrome ? new ChromeStorageDriver() : new LocalStorageDriver();
  return driver;
}

/** For tests / previews that want to force a specific driver. */
export function setDriver(d: StorageDriver): void {
  driver = d;
}
