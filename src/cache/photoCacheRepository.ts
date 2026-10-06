import { createHash } from "node:crypto";
import { DataSource, In, LessThan } from "typeorm";
import { PhotoProvider, QueryResult, StockImage } from "../types.js";
import {
  PhotoEntity,
  PhotoRecord,
  QueryCacheEntity,
  QueryCachePhotoEntity,
  QueryCachePhotoRecord,
  QueryCacheRecord,
} from "./entities.js";

export type CacheEndpoint = "curated" | "search" | "ratio" | "color";

export interface CacheDescriptor {
  endpoint: CacheEndpoint;
  provider: PhotoProvider | "all";
  query: string;
  page: number;
  perPage: number;
  orientation?: string;
  color?: string;
  ratio?: string;
}

/** Lightweight entry header; photos are loaded lazily only when actually served. */
export interface CachedEntry {
  id: number;
  key: string;
  isFallback: boolean;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
}

const KEY_VERSION = "v1";
const DELETE_CHUNK = 500;

/** Normalizes params so equivalent requests ("Dog ", "dog") share a cache row. */
export function normalizeDescriptor(d: CacheDescriptor): CacheDescriptor {
  return {
    endpoint: d.endpoint,
    provider: d.provider || "all",
    query: normalizeQuery(d.query),
    page: Math.max(1, Math.floor(d.page || 1)),
    perPage: Math.max(1, Math.floor(d.perPage || 24)),
    orientation: d.orientation || undefined,
    color: d.color ? d.color.toLowerCase().trim() : undefined,
    ratio: d.ratio || undefined,
  };
}

function normalizeQuery(q: string | undefined): string {
  return (q || "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function buildCacheKey(d: CacheDescriptor): string {
  const n = normalizeDescriptor(d);
  return [
    KEY_VERSION,
    n.endpoint,
    n.provider,
    `q=${encodeURIComponent(n.query)}`,
    `p=${n.page}`,
    `pp=${n.perPage}`,
    `o=${n.orientation ?? ""}`,
    `c=${encodeURIComponent(n.color ?? "")}`,
    `r=${encodeURIComponent(n.ratio ?? "")}`,
  ].join("|");
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

const toNum = (v: unknown) => Number(v ?? 0);

/**
 * All persistence for the cache, written against the TypeORM API so the same code
 * runs on SQLite, MySQL and PostgreSQL. No dialect-specific SQL except the optional
 * storage-size probe in stats().
 */
export class PhotoCacheRepository {
  constructor(private readonly ds: DataSource) {}

  private get entries() {
    return this.ds.getRepository(QueryCacheEntity);
  }
  private get links() {
    return this.ds.getRepository(QueryCachePhotoEntity);
  }
  private get photos() {
    return this.ds.getRepository(PhotoEntity);
  }

  async getEntry(key: string): Promise<CachedEntry | null> {
    const row = await this.entries.findOne({
      where: { keyHash: hashKey(key) },
      select: { id: true, cacheKey: true, isFallback: true, createdAt: true, expiresAt: true, hitCount: true },
    });
    if (!row) return null;
    return {
      id: row.id,
      key: row.cacheKey,
      isFallback: !!row.isFallback,
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
      hitCount: row.hitCount,
    };
  }

  async loadResult(entryId: number): Promise<QueryResult | null> {
    const entry = await this.entries.findOne({
      where: { id: entryId },
      select: { id: true, resultProvider: true, isFallback: true, warning: true },
    });
    if (!entry) return null;

    const links = await this.links.find({
      where: { cacheId: entryId },
      relations: { photo: true },
      order: { position: "ASC" },
    });

    const photos: StockImage[] = [];
    for (const link of links) {
      if (link.photo) photos.push(toStockImage(link, link.photo));
    }

    return {
      photos,
      fallback: !!entry.isFallback,
      warning: entry.warning ?? undefined,
      provider: entry.resultProvider as PhotoProvider | "all",
    };
  }

  async touch(id: number): Promise<void> {
    await this.entries
      .createQueryBuilder()
      .update()
      .set({ hitCount: () => `${this.ds.driver.escape("hit_count")} + 1`, lastAccessedAt: Date.now() })
      .where("id = :id", { id })
      .execute();
  }

  /** Writes the query + its photos atomically (upserts are dialect-aware via TypeORM). */
  async store(key: string, descriptor: CacheDescriptor, result: QueryResult, ttlMs: number): Promise<void> {
    const d = normalizeDescriptor(descriptor);
    const now = Date.now();
    const keyHash = hashKey(key);

    // The same photo can't appear twice in one multi-row upsert (Postgres rejects it)
    const uniquePhotos = [...new Map(result.photos.map((p) => [p.id, p])).values()];

    await this.ds.transaction(async (m) => {
      if (uniquePhotos.length > 0) {
        await m
          .createQueryBuilder()
          .insert()
          .into(PhotoEntity)
          .values(
            uniquePhotos.map(
              (p): PhotoRecord => ({
                id: p.id,
                provider: p.provider ?? null,
                url: p.url,
                title: p.title,
                category: p.category,
                aspectRatio: p.aspectRatio,
                dimensions: p.dimensions,
                dominantColor: p.dominantColor,
                authorName: p.author?.name ?? null,
                authorUsername: p.author?.username ?? null,
                authorLink: p.author?.link ?? null,
                downloadLocation: p.downloadLocation ?? null,
                firstSeenAt: now,
                updatedAt: now,
              })
            )
          )
          // On conflict refresh mutable metadata; keep first_seen_at / canonical provider & ratio
          .orUpdate(
            [
              "url",
              "title",
              "category",
              "dimensions",
              "dominant_color",
              "author_name",
              "author_username",
              "author_link",
              "download_location",
              "updated_at",
            ],
            ["id"]
          )
          .execute();
      }

      await m
        .createQueryBuilder()
        .insert()
        .into(QueryCacheEntity)
        .values({
          keyHash,
          cacheKey: key,
          endpoint: d.endpoint,
          provider: d.provider,
          query: d.query,
          page: d.page,
          perPage: d.perPage,
          orientation: d.orientation ?? null,
          color: d.color ?? null,
          ratio: d.ratio ?? null,
          resultProvider: result.provider,
          isFallback: !!result.fallback,
          warning: result.warning ?? null,
          photoCount: result.photos.length,
          createdAt: now,
          expiresAt: now + ttlMs,
          hitCount: 0,
          lastAccessedAt: now,
        })
        .orUpdate(
          [
            "result_provider",
            "is_fallback",
            "warning",
            "photo_count",
            "created_at",
            "expires_at",
            "last_accessed_at",
          ],
          ["key_hash"]
        )
        .execute();

      const entry = await m.getRepository(QueryCacheEntity).findOneOrFail({
        where: { keyHash },
        select: { id: true },
      });

      await m.getRepository(QueryCachePhotoEntity).delete({ cacheId: entry.id });

      if (result.photos.length > 0) {
        await m
          .createQueryBuilder()
          .insert()
          .into(QueryCachePhotoEntity)
          .values(
            result.photos.map(
              (p, position): QueryCachePhotoRecord => ({
                cacheId: entry.id,
                position,
                photoId: p.id,
                provider: p.provider ?? null,
                aspectRatio: p.aspectRatio,
                matchScore: typeof p.matchScore === "number" ? p.matchScore : null,
                isFallback: !!p.isFallback,
                fallbackReason: p.fallbackReason ?? null,
              })
            )
          )
          .execute();
      }
    });
  }

  /** Removes entries that expired before `cutoff`, then photos no longer referenced. */
  async purge(cutoff: number): Promise<{ entries: number; photos: number }> {
    const res = await this.entries.delete({ expiresAt: LessThan(cutoff) });
    const photos = await this.deleteOrphanPhotos();
    return { entries: res.affected ?? 0, photos };
  }

  /** Keeps the table under `maxEntries` by evicting least-recently-used queries. */
  async enforceMaxEntries(maxEntries: number): Promise<number> {
    const total = await this.entries.count();
    if (total <= maxEntries) return 0;

    // Select-then-delete: MySQL doesn't support LIMIT inside IN (subquery)
    const victims = await this.entries.find({
      select: { id: true },
      order: { lastAccessedAt: "ASC" },
      take: total - maxEntries,
    });
    const evicted = await this.deleteEntriesByIds(victims.map((v) => v.id));
    await this.deleteOrphanPhotos();
    return evicted;
  }

  async clear(filter: { endpoint?: string; provider?: string; query?: string } = {}) {
    const where: Partial<Record<"endpoint" | "provider" | "query", string>> = {};
    if (filter.endpoint) where.endpoint = filter.endpoint;
    if (filter.provider) where.provider = filter.provider;
    if (filter.query !== undefined) where.query = normalizeQuery(filter.query);

    let entries: number;
    if (Object.keys(where).length === 0) {
      entries = (await this.entries.createQueryBuilder().delete().execute()).affected ?? 0;
    } else {
      entries = (await this.entries.delete(where)).affected ?? 0;
    }
    const photos = await this.deleteOrphanPhotos();
    return { entries, photos };
  }

  async stats(now = Date.now()) {
    const totals = await this.entries
      .createQueryBuilder("q")
      .select("COUNT(*)", "entries")
      .addSelect("COALESCE(SUM(CASE WHEN q.expiresAt >= :now THEN 1 ELSE 0 END), 0)", "fresh")
      .addSelect("COALESCE(SUM(CASE WHEN q.expiresAt < :now THEN 1 ELSE 0 END), 0)", "expired")
      .addSelect("COALESCE(SUM(q.hitCount), 0)", "totalHits")
      .setParameter("now", now)
      .getRawOne();

    const byEndpoint = await this.entries
      .createQueryBuilder("q")
      .select("q.endpoint", "endpoint")
      .addSelect("COUNT(*)", "entries")
      .addSelect("COALESCE(SUM(q.hitCount), 0)", "hits")
      .groupBy("q.endpoint")
      .getRawMany();

    const byProvider = await this.photos
      .createQueryBuilder("p")
      .select("p.provider", "provider")
      .addSelect("COUNT(*)", "photos")
      .groupBy("p.provider")
      .getRawMany();

    const top = await this.entries.find({
      select: {
        endpoint: true,
        provider: true,
        query: true,
        page: true,
        hitCount: true,
        photoCount: true,
        createdAt: true,
        expiresAt: true,
      },
      order: { hitCount: "DESC", createdAt: "DESC" },
      take: 10,
    });

    return {
      entries: toNum(totals?.entries),
      fresh: toNum(totals?.fresh),
      expired: toNum(totals?.expired),
      totalHits: toNum(totals?.totalHits),
      photos: await this.photos.count(),
      byEndpoint: byEndpoint.map((r) => ({ endpoint: r.endpoint, entries: toNum(r.entries), hits: toNum(r.hits) })),
      byProvider: byProvider.map((r) => ({ provider: r.provider ?? "unknown", photos: toNum(r.photos) })),
      topQueries: top.map((t) => ({
        endpoint: t.endpoint,
        provider: t.provider,
        query: t.query,
        page: t.page,
        hits: t.hitCount,
        photos: t.photoCount,
        cachedAt: new Date(t.createdAt).toISOString(),
        expiresAt: new Date(t.expiresAt).toISOString(),
      })),
      storageBytes: await this.storageSize(),
    };
  }

  // ---- helpers ----

  private async deleteEntriesByIds(ids: number[]): Promise<number> {
    let affected = 0;
    for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
      const res = await this.entries.delete({ id: In(ids.slice(i, i + DELETE_CHUNK)) });
      affected += res.affected ?? 0;
    }
    return affected;
  }

  private async deleteOrphanPhotos(): Promise<number> {
    const e = (name: string) => this.ds.driver.escape(name);
    const res = await this.ds
      .createQueryBuilder()
      .delete()
      .from(PhotoEntity)
      .where(
        `NOT EXISTS (SELECT 1 FROM ${e("query_cache_photos")} qcp WHERE qcp.${e("photo_id")} = ${e("photos")}.${e("id")})`
      )
      .execute();
    return res.affected ?? 0;
  }

  /** Best-effort size of the cache tables (dialect-specific catalog queries). */
  private async storageSize(): Promise<number | null> {
    try {
      const type = this.ds.options.type;
      if (type === "better-sqlite3" || type === "sqlite") {
        const [{ page_count }] = await this.ds.query("PRAGMA page_count");
        const [{ page_size }] = await this.ds.query("PRAGMA page_size");
        return toNum(page_count) * toNum(page_size);
      }
      if (type === "postgres") {
        const [row] = await this.ds.query(
          `SELECT COALESCE(pg_total_relation_size('photos'), 0)
                + COALESCE(pg_total_relation_size('query_cache'), 0)
                + COALESCE(pg_total_relation_size('query_cache_photos'), 0) AS size`
        );
        return toNum(row?.size);
      }
      if (type === "mysql" || type === "mariadb") {
        const [row] = await this.ds.query(
          `SELECT COALESCE(SUM(data_length + index_length), 0) AS size
             FROM information_schema.tables
            WHERE table_schema = DATABASE()
              AND table_name IN ('photos', 'query_cache', 'query_cache_photos')`
        );
        return toNum(row?.size);
      }
    } catch {
      /* size is informational only */
    }
    return null;
  }
}

function toStockImage(link: QueryCachePhotoRecord, p: PhotoRecord): StockImage {
  const photo: StockImage = {
    id: p.id,
    url: p.url,
    title: p.title,
    category: p.category,
    aspectRatio: link.aspectRatio ?? p.aspectRatio,
    dimensions: p.dimensions,
    dominantColor: p.dominantColor,
  };
  const provider = (link.provider ?? p.provider) as PhotoProvider | null;
  if (provider) photo.provider = provider;
  if (link.matchScore !== null && link.matchScore !== undefined) photo.matchScore = link.matchScore;
  if (link.isFallback) photo.isFallback = true;
  if (link.fallbackReason) photo.fallbackReason = link.fallbackReason;
  if (p.authorName) {
    photo.author = { name: p.authorName, username: p.authorUsername ?? "", link: p.authorLink ?? "" };
  }
  if (p.downloadLocation) photo.downloadLocation = p.downloadLocation;
  return photo;
}
