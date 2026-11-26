export interface SecurityCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

interface CacheEntry<T> {
  promise: Promise<T>;
  expiresAt: number | null;
}

/**
 * Caches successful analyses per mint and shares in-flight work.
 * Rejected analyses are removed immediately so a later event can retry.
 */
export function createSecurityAnalysisCache<T>(
  analyze: (mint: string) => Promise<T>,
  options: SecurityCacheOptions = {},
): (mint: string) => Promise<T> {
  const ttlMs = options.ttlMs ?? 60_000;
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? Date.now;

  if (!Number.isFinite(ttlMs) || ttlMs < 0) {
    throw new Error("Security cache TTL must be a non-negative number");
  }
  if (!Number.isInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Security cache maxEntries must be a positive integer");
  }

  const entries = new Map<string, CacheEntry<T>>();

  return (mint: string): Promise<T> => {
    const currentTime = now();
    const existing = entries.get(mint);
    if (existing && (existing.expiresAt === null || existing.expiresAt > currentTime)) {
      // Refresh insertion order so the least recently used entry is evicted first.
      entries.delete(mint);
      entries.set(mint, existing);
      return existing.promise;
    }
    if (existing) entries.delete(mint);

    // Remove expired entries before enforcing the size limit.
    for (const [key, entry] of entries) {
      if (entry.expiresAt !== null && entry.expiresAt <= currentTime) {
        entries.delete(key);
      }
    }
    while (entries.size >= maxEntries) {
      const oldestKey = entries.keys().next().value as string | undefined;
      if (oldestKey === undefined) break;
      entries.delete(oldestKey);
    }

    const entry: CacheEntry<T> = {
      promise: Promise.resolve().then(() => analyze(mint)),
      expiresAt: null,
    };
    entries.set(mint, entry);

    entry.promise.then(
      () => {
        if (entries.get(mint) === entry) entry.expiresAt = now() + ttlMs;
      },
      () => {
        if (entries.get(mint) === entry) entries.delete(mint);
      },
    );

    return entry.promise;
  };
}
