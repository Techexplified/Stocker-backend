import { DataSource } from "typeorm";
import { QueryResult, SmartQueryOptions } from "../types.js";
import {
  buildCacheDbConfig,
  CacheDbConfig,
  closeCacheDataSource,
  initCacheDataSource,
  isDatabaseConfigured,
  testConnection,
} from "../cache/dataSource.js";
import {
  buildCacheKey,
  CacheDescriptor,
  CacheEndpoint,
  CachedEntry,
  PhotoCacheRepository,
} from "../cache/photoCacheRepository.js";
import { photoAggregator } from "./photoAggregator.js";

export type CacheStatus = "HIT" | "MISS" | "STALE" | "BYPASS" | "SKIPPED" | "DISABLED";

export interface CacheMeta {
  status: CacheStatus;
  key?: string;
  cachedAt?: string;
  expiresAt?: string;
  ageSeconds?: number;
  reason?: string;
}

export interface CachedQueryResult extends QueryResult {
  cache: CacheMeta;
}

interface CacheConfig {
  enabled: boolean;
  isDbConfigured: boolean;
  dbConfig: CacheDbConfig;
  ttlMs: Record<CacheEndpoint, number>;
  fallbackTtlMs: number;
  staleMaxAgeMs: number;
  maxEntries: number;
  cleanupIntervalMs: number;
}

const seconds = (envVal: string | undefined, def: number) => {
  const n = parseInt(envVal ?? "", 10);
  return (Number.isFinite(n) && n >= 0 ? n : def) * 1000;
};

function loadConfig(): CacheConfig {
  const env = process.env;
  const isDbConfigured = isDatabaseConfigured(env);
  const enabled = (env.CACHE_ENABLED ?? "true").toLowerCase() !== "false" && isDbConfigured;
  const dbConfig = buildCacheDbConfig(env);

  return {
    enabled,
    isDbConfigured,
    dbConfig,
    ttlMs: {
      // Stock photos are relatively static: cache for days to conserve limited API quotas (e.g. Unsplash 50 req/hr)
      search: seconds(env.CACHE_TTL_SEARCH, 7 * 24 * 60 * 60), // 7 days for search queries
      ratio: seconds(env.CACHE_TTL_RATIO || env.CACHE_TTL_SEARCH, 7 * 24 * 60 * 60), // 7 days for aspect ratios
      color: seconds(env.CACHE_TTL_COLOR || env.CACHE_TTL_SEARCH, 7 * 24 * 60 * 60), // 7 days for brand colors
      curated: seconds(env.CACHE_TTL_CURATED, 2 * 24 * 60 * 60), // 2 days for curated home feed
    },
    fallbackTtlMs: seconds(env.CACHE_TTL_FALLBACK, 5 * 60), // 5 min for degraded/fallback results
    staleMaxAgeMs: seconds(env.CACHE_STALE_MAX_AGE, 30 * 24 * 60 * 60), // serve stale up to 30 days if APIs fail/rate-limited
    maxEntries: parseInt(env.CACHE_MAX_ENTRIES ?? "", 10) || 20000, // hold thousands of searches comfortably
    cleanupIntervalMs: seconds(env.CACHE_CLEANUP_INTERVAL, 60 * 60), // hourly cleanup
  };
}

/**
 * Cache-aside layer in front of PhotoAggregator using TypeORM:
 *
 *   1. Health check & circuit breaker: if the database is unreachable or fails,
 *      the cache layer is SKIPPED ENTIRELY with zero latency overhead.
 *   2. Long TTLs (days): designed for image catalogs with strict API rate limits.
 *   3. Fresh hit         → returned in ~1-3ms without calling external APIs.
 *   4. Miss / expired    → calls provider APIs, saves to DB, returns to client.
 *   5. Provider failure  → serves stale cached photos (up to 30 days) if available.
 *   6. Auto-recovery     → background probe restores caching when DB comes back online.
 */
class CachedPhotoService {
  private config: CacheConfig = loadConfig();
  private ds: DataSource | null = null;
  private repo: PhotoCacheRepository | null = null;
  private isConnected = false;
  private circuitOpenUntil = 0;
  private consecutiveDbErrors = 0;
  private lastDbError?: string;
  private reconnectTimer: NodeJS.Timeout | null = null;

  private inflight = new Map<string, Promise<CachedQueryResult>>();
  private cleanupTimer: NodeJS.Timeout | null = null;
  private counters = { hits: 0, misses: 0, stale: 0, bypass: 0, skipped: 0, errors: 0, coalesced: 0 };
  private initError?: string;

  async init(): Promise<void> {
    this.config = loadConfig();
    if (!this.config.isDbConfigured) {
      console.log("🗄️  Cache:        ⏸️  No database env provided (caching bypassed; direct API mode)");
      this.isConnected = false;
      return;
    }
    if (!this.config.enabled) {
      console.log("🗄️  Cache:        ⏸️  Disabled (CACHE_ENABLED=false)");
      this.isConnected = false;
      return;
    }

    try {
      const ds = await initCacheDataSource(this.config.dbConfig);
      if (!ds) {
        throw new Error("Data source initialization returned null");
      }
      this.ds = ds;
      this.repo = new PhotoCacheRepository(ds);
      this.isConnected = true;
      this.lastDbError = undefined;

      // In Vercel serverless functions, background setInterval timers must not be spawned
      if (!process.env.VERCEL) {
        await this.runMaintenance();
        this.cleanupTimer = setInterval(() => {
          this.runMaintenance().catch((err) => {
            console.error("[Cache] Background maintenance error:", err?.message);
          });
        }, this.config.cleanupIntervalMs);
        this.cleanupTimer.unref();
      }

      const searchDays = Math.round(this.config.ttlMs.search / (24 * 3600 * 1000));
      const curatedDays = Math.round(this.config.ttlMs.curated / (24 * 3600 * 1000));
      console.log(
        `🗄️  Cache:        ✅ ${this.config.dbConfig.type.toUpperCase()} ORM via TypeORM (${this.config.dbConfig.target}) [TTL: ${searchDays}d search, ${curatedDays}d curated]`
      );
    } catch (err: any) {
      this.initError = err?.message || String(err);
      this.lastDbError = this.initError;
      this.repo = null;
      this.ds = null;
      this.isConnected = false;
      this.circuitOpenUntil = Date.now() + 30000;

      console.warn(
        `🗄️  Cache:        ⚠️  Database connection unavailable (${this.initError}). Skipping cache layer entirely; live APIs active.`
      );
      if (!process.env.VERCEL) {
        this.ensureReconnectTimer();
      }
    }
  }

  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    if (this.reconnectTimer) clearInterval(this.reconnectTimer);
    this.cleanupTimer = null;
    this.reconnectTimer = null;
    this.repo = null;
    this.ds = null;
    this.isConnected = false;
    await closeCacheDataSource();
  }

  get isEnabled(): boolean {
    return this.config.enabled && this.config.isDbConfigured;
  }

  get isOperational(): boolean {
    if (!this.config.isDbConfigured || !this.config.enabled || !this.repo || !this.isConnected) return false;
    if (Date.now() < this.circuitOpenUntil) return false;
    return true;
  }

  get isActive(): boolean {
    return this.isOperational;
  }

  get status(): "CONNECTED" | "SKIPPED" | "DISABLED" {
    if (!this.config.isDbConfigured || !this.config.enabled) return "SKIPPED";
    if (!this.isConnected || Date.now() < this.circuitOpenUntil) return "SKIPPED";
    return "CONNECTED";
  }

  get engine(): string {
    return this.config.dbConfig.type;
  }

  get target(): string {
    return this.config.dbConfig.target;
  }

  get lastError(): string | undefined {
    return this.lastDbError || this.initError;
  }

  // ---- Public query API (mirrors PhotoAggregator) ----

  getCurated(options: SmartQueryOptions, bypass = false) {
    return this.resolve(
      { endpoint: "curated", provider: options.provider ?? "all", query: "", page: options.page ?? 1, perPage: options.perPage ?? 24 },
      () => photoAggregator.getCurated(options),
      bypass
    );
  }

  search(query: string, options: SmartQueryOptions, bypass = false) {
    return this.resolve(
      {
        endpoint: "search",
        provider: options.provider ?? "all",
        query,
        page: options.page ?? 1,
        perPage: options.perPage ?? 24,
        orientation: options.orientation,
        color: options.color,
      },
      () => photoAggregator.search(query, options),
      bypass
    );
  }

  getByRatio(ratio: string, options: SmartQueryOptions, bypass = false) {
    return this.resolve(
      { endpoint: "ratio", provider: options.provider ?? "all", query: "", page: options.page ?? 1, perPage: options.perPage ?? 24, ratio },
      () => photoAggregator.getByRatio(ratio, options),
      bypass
    );
  }

  getByColor(color: string, options: SmartQueryOptions, bypass = false) {
    return this.resolve(
      { endpoint: "color", provider: options.provider ?? "all", query: "", page: options.page ?? 1, perPage: options.perPage ?? 24, color },
      () => photoAggregator.getByColor(color, options),
      bypass
    );
  }

  // ---- Admin ----

  async stats() {
    const { hits, misses, stale, skipped, bypass } = this.counters;
    const served = hits + misses + stale;
    const base = {
      enabled: this.config.enabled,
      configured: this.config.isDbConfigured,
      active: this.isOperational,
      status: this.status,
      engine: this.config.dbConfig.type,
      target: this.config.dbConfig.target,
      lastError: this.lastError,
      circuitOpen: Date.now() < this.circuitOpenUntil,
      message: !this.config.isDbConfigured
        ? "No database environment configured. Caching is disabled and queries pass through directly to provider APIs."
        : undefined,
      config: {
        ttlDays: {
          search: Number((this.config.ttlMs.search / (24 * 3600 * 1000)).toFixed(1)),
          curated: Number((this.config.ttlMs.curated / (24 * 3600 * 1000)).toFixed(1)),
          ratio: Number((this.config.ttlMs.ratio / (24 * 3600 * 1000)).toFixed(1)),
          color: Number((this.config.ttlMs.color / (24 * 3600 * 1000)).toFixed(1)),
        },
        ttlSeconds: Object.fromEntries(Object.entries(this.config.ttlMs).map(([k, v]) => [k, v / 1000])),
        fallbackTtlSeconds: this.config.fallbackTtlMs / 1000,
        staleMaxAgeDays: Number((this.config.staleMaxAgeMs / (24 * 3600 * 1000)).toFixed(1)),
        maxEntries: this.config.maxEntries,
      },
      session: {
        hits,
        misses,
        stale,
        bypass,
        skipped,
        errors: this.counters.errors,
        coalesced: this.counters.coalesced,
        hitRatio: served ? Number(((hits + stale) / served).toFixed(3)) : 0,
        inflight: this.inflight.size,
      },
    };
    if (!this.repo || !this.isConnected) return base;
    try {
      const storage = await this.repo.stats();
      return { ...base, storage };
    } catch (err: any) {
      return { ...base, storageError: err?.message };
    }
  }

  async clear(filter: { endpoint?: string; provider?: string; query?: string } = {}) {
    if (!this.isOperational || !this.repo) return { entries: 0, photos: 0 };
    return await this.repo.clear(filter);
  }

  async runMaintenance(): Promise<{ purged: { entries: number; photos: number }; evicted: number } | null> {
    if (!this.isOperational || !this.repo) return null;
    try {
      const purged = await this.repo.purge(Date.now() - this.config.staleMaxAgeMs);
      const evicted = await this.repo.enforceMaxEntries(this.config.maxEntries);
      if (purged.entries || evicted) {
        console.log(`[Cache] Maintenance: purged ${purged.entries} queries / ${purged.photos} photos, evicted ${evicted}`);
      }
      return { purged, evicted };
    } catch (err: any) {
      this.counters.errors++;
      console.error("[Cache] Maintenance failed:", err?.message);
      return null;
    }
  }

  // ---- Core cache-aside logic ----

  private async resolve(
    descriptor: CacheDescriptor,
    fetcher: () => Promise<QueryResult>,
    bypass: boolean
  ): Promise<CachedQueryResult> {
    // 0. Fallback: If DB is not configured, disconnected, circuit is open, or cache disabled, skip cache entirely
    if (!this.isOperational) {
      // In serverless / Vercel, if circuit open cooldown expired and DB is configured, lazily test reconnect
      if (
        this.config.isDbConfigured &&
        this.config.enabled &&
        !this.isConnected &&
        Date.now() >= this.circuitOpenUntil
      ) {
        await this.probeConnection().catch(() => {});
      }

      if (!this.isOperational) {
        this.counters.skipped++;
        const result = await fetcher();
        const reason = !this.config.isDbConfigured
          ? "No database configured (DB env omitted); direct API mode"
          : !this.config.enabled
          ? "Cache disabled by configuration"
          : (this.lastDbError || "Database connection unavailable; skipped cache layer entirely");

        return {
          ...result,
          cache: {
            status: "SKIPPED",
            reason,
          },
        };
      }
    }

    const key = buildCacheKey(descriptor);
    const now = Date.now();
    const existing = await this.safeAsync(() => this.repo!.getEntry(key));

    // 1. Fresh hit → return immediately (no external API call)
    if (existing && !bypass && existing.expiresAt > now) {
      const cachedResult = await this.safeAsync(() => this.repo!.loadResult(existing.id));
      if (cachedResult) {
        this.counters.hits++;
        this.safeAsync(() => this.repo!.touch(existing.id)).catch(() => {});
        return this.withMeta(cachedResult, "HIT", existing);
      }
    }

    // 2. Coalesce identical in-flight misses
    const pending = this.inflight.get(key);
    if (pending) {
      this.counters.coalesced++;
      return pending;
    }

    const task = this.fetchAndStore(key, descriptor, fetcher, existing, bypass).finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, task);
    return task;
  }

  private async fetchAndStore(
    key: string,
    descriptor: CacheDescriptor,
    fetcher: () => Promise<QueryResult>,
    existing: CachedEntry | null,
    bypass: boolean
  ): Promise<CachedQueryResult> {
    const staleUsable =
      existing && !existing.isFallback && Date.now() - existing.expiresAt <= this.config.staleMaxAgeMs;

    let result: QueryResult;
    try {
      result = await fetcher();
    } catch (err) {
      if (staleUsable && this.isOperational) {
        const staleResult = await this.safeAsync(() => this.repo!.loadResult(existing!.id));
        if (staleResult) {
          this.counters.stale++;
          return this.withMeta(
            { ...staleResult, warning: "Photo providers are unavailable; showing recently cached results." },
            "STALE",
            existing!
          );
        }
      }
      throw err;
    }

    // Providers degraded to offline catalog, but we have real cached photos → prefer those
    if (result.fallback && staleUsable && this.isOperational) {
      const staleResult = await this.safeAsync(() => this.repo!.loadResult(existing!.id));
      if (staleResult && staleResult.photos.length > 0) {
        this.counters.stale++;
        return this.withMeta(
          { ...staleResult, warning: "Some providers are unavailable; showing recently cached results." },
          "STALE",
          existing!
        );
      }
    }

    if (bypass) this.counters.bypass++;
    else this.counters.misses++;

    const now = Date.now();
    const ttl = result.photos.length > 0 && this.isOperational
      ? (result.fallback ? this.config.fallbackTtlMs : this.config.ttlMs[descriptor.endpoint])
      : 0;

    if (ttl > 0 && this.isOperational) {
      await this.safeAsync(() => this.repo!.store(key, descriptor, result, ttl));
    }

    return {
      ...result,
      cache: {
        status: bypass ? "BYPASS" : "MISS",
        key,
        cachedAt: new Date(now).toISOString(),
        expiresAt: ttl > 0 ? new Date(now + ttl).toISOString() : undefined,
        ageSeconds: 0,
      },
    };
  }

  private withMeta(result: QueryResult, status: CacheStatus, entry: CachedEntry): CachedQueryResult {
    return {
      ...result,
      cache: {
        status,
        key: entry.key,
        cachedAt: new Date(entry.createdAt).toISOString(),
        expiresAt: new Date(entry.expiresAt).toISOString(),
        ageSeconds: Math.round((Date.now() - entry.createdAt) / 1000),
      },
    };
  }

  /** DB errors fail open: trip the circuit breaker on repeated failure to skip the cache layer entirely. */
  private async safeAsync<T>(fn: () => Promise<T>): Promise<T | null> {
    try {
      const res = await fn();
      if (this.consecutiveDbErrors > 0) {
        this.consecutiveDbErrors = 0;
      }
      return res;
    } catch (err: any) {
      this.counters.errors++;
      this.consecutiveDbErrors++;
      this.lastDbError = err?.message || String(err);
      console.error(`[Cache] Database operation error (${this.consecutiveDbErrors}):`, this.lastDbError);

      if (this.consecutiveDbErrors >= 2) {
        this.tripCircuitBreaker();
      }
      return null;
    }
  }

  private tripCircuitBreaker(): void {
    this.isConnected = false;
    this.circuitOpenUntil = Date.now() + 30000; // 30s cooldown
    console.warn(
      `[Cache] ⚠️ Database connection failed. Circuit breaker tripped: skipping cache layer entirely for 30s (live APIs active).`
    );
    if (!process.env.VERCEL) {
      this.ensureReconnectTimer();
    }
  }

  private ensureReconnectTimer(): void {
    if (process.env.VERCEL) return;
    if (this.reconnectTimer) return;
    this.reconnectTimer = setInterval(async () => {
      await this.probeConnection();
    }, 30000);
    this.reconnectTimer.unref();
  }

  private async probeConnection(): Promise<void> {
    if (!this.config.isDbConfigured || !this.config.enabled) return;
    if (this.isConnected && Date.now() >= this.circuitOpenUntil) {
      if (this.reconnectTimer) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      return;
    }

    try {
      if (!this.ds || !this.ds.isInitialized) {
        await closeCacheDataSource();
        const ds = await initCacheDataSource(this.config.dbConfig);
        if (!ds) throw new Error("DataSource initialization returned null");
        this.ds = ds;
        this.repo = new PhotoCacheRepository(ds);
      } else {
        const ok = await testConnection(this.ds);
        if (!ok) throw new Error("Connection test probe failed");
      }

      this.isConnected = true;
      this.consecutiveDbErrors = 0;
      this.circuitOpenUntil = 0;
      this.lastDbError = undefined;
      console.log(`[Cache] ✅ Database connection restored. Cache layer re-enabled (${this.config.dbConfig.type.toUpperCase()}).`);
      if (this.reconnectTimer) {
        clearInterval(this.reconnectTimer);
        this.reconnectTimer = null;
      }
    } catch (err: any) {
      this.lastDbError = err?.message || String(err);
      this.circuitOpenUntil = Date.now() + 30000;
    }
  }
}

export const cachedPhotoService = new CachedPhotoService();
