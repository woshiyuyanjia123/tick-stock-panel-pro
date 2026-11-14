import fs from 'node:fs';
import path from 'node:path';

export const APP_ROOT_DIR = process.env.TSP_APP_ROOT
  ? path.resolve(process.env.TSP_APP_ROOT)
  : process.cwd();
export const DATA_DIR = process.env.TSP_DATA_DIR
  ? path.resolve(process.env.TSP_DATA_DIR)
  : path.resolve(APP_ROOT_DIR, 'data');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

ensureDir(DATA_DIR);
ensureDir(CACHE_DIR);

interface MemoryCacheEntry<T> {
  value: T;
  expiresAt: number;
}

const memCache = new Map<string, MemoryCacheEntry<any>>();
const inflight = new Map<string, Promise<any>>();

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

export async function fetchBufferWithRetry(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 9000,
  retries = 2
): Promise<Buffer> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        headers: { ...DEFAULT_HEADERS, ...headers },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} for ${url}`);
      }
      const ab = await res.arrayBuffer();
      return Buffer.from(ab);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

export async function fetchJsonWithRetry<T = any>(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 9000,
  retries = 2
): Promise<T> {
  const buf = await fetchBufferWithRetry(url, headers, timeoutMs, retries);
  const text = buf.toString('utf8').trim();
  if (!text) {
    throw new Error(`Empty JSON body for ${url}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON for ${url}: ${text.slice(0, 120)}`);
  }
}

export async function fetchGbkTextWithRetry(
  url: string,
  headers: Record<string, string> = {},
  timeoutMs = 9000,
  retries = 2
): Promise<string> {
  const buf = await fetchBufferWithRetry(url, headers, timeoutMs, retries);
  return new TextDecoder('gbk').decode(buf);
}

function cacheFilePath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(CACHE_DIR, `${safe}.json`);
}

export function readDiskCache<T>(key: string): { value: T; savedAt: number } | null {
  try {
    const fp = cacheFilePath(key);
    if (!fs.existsSync(fp)) return null;
    const raw = fs.readFileSync(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && 'value' in parsed) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeDiskCache<T>(key: string, value: T): void {
  try {
    ensureDir(CACHE_DIR);
    const fp = cacheFilePath(key);
    fs.writeFileSync(fp, JSON.stringify({ savedAt: Date.now(), value }), 'utf8');
  } catch {
    // ignore disk cache write failure
  }
}

export async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
  options?: { persistDisk?: boolean; diskMaxAgeMs?: number }
): Promise<T> {
  const now = Date.now();
  const mem = memCache.get(key);
  if (mem && mem.expiresAt > now) {
    return mem.value as T;
  }

  if (options?.persistDisk) {
    const disk = readDiskCache<T>(key);
    const maxAge = options.diskMaxAgeMs ?? ttlMs;
    if (disk && now - disk.savedAt < maxAge) {
      memCache.set(key, { value: disk.value, expiresAt: now + ttlMs });
      return disk.value;
    }
  }

  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    try {
      const value = await fetcher();
      memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
      if (options?.persistDisk) {
        writeDiskCache(key, value);
      }
      return value;
    } catch (err) {
      // Stale fallback from memory or disk so live endpoints stay resilient
      if (mem) return mem.value as T;
      const disk = readDiskCache<T>(key);
      if (disk) return disk.value;
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, p);
  return p;
}

export function clearMemoryCache(prefix?: string): void {
  if (!prefix) {
    memCache.clear();
    return;
  }
  for (const k of memCache.keys()) {
    if (k.startsWith(prefix)) memCache.delete(k);
  }
}
