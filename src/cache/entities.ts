import { EntitySchema, ValueTransformer } from "typeorm";

/**
 * ORM entity definitions shared by SQLite, MySQL and PostgreSQL.
 *
 * EntitySchema (instead of decorators) keeps the models plain TypeScript and works with
 * both `tsc` and `tsx`/esbuild without `emitDecoratorMetadata`.
 *
 * Only column types supported by all three drivers are used. Epoch-millisecond timestamps
 * are stored as BIGINT and converted back to numbers (pg/mysql return BIGINT as strings).
 */

const epochMs: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v: string | number | null) => (v === null || v === undefined ? null : Number(v)),
};

const toNumber: ValueTransformer = {
  to: (v?: number | null) => v,
  from: (v: string | number | null) => (v === null || v === undefined ? null : Number(v)),
};

export interface PhotoRecord {
  id: string;
  provider: string | null;
  url: string;
  title: string;
  category: string;
  aspectRatio: string;
  dimensions: string;
  dominantColor: string;
  authorName: string | null;
  authorUsername: string | null;
  authorLink: string | null;
  downloadLocation: string | null;
  firstSeenAt: number;
  updatedAt: number;
}

export interface QueryCacheRecord {
  id: number;
  keyHash: string;
  cacheKey: string;
  endpoint: string;
  provider: string;
  query: string;
  page: number;
  perPage: number;
  orientation: string | null;
  color: string | null;
  ratio: string | null;
  resultProvider: string;
  isFallback: boolean;
  warning: string | null;
  photoCount: number;
  createdAt: number;
  expiresAt: number;
  hitCount: number;
  lastAccessedAt: number;
}

export interface QueryCachePhotoRecord {
  cacheId: number;
  position: number;
  photoId: string;
  provider: string | null;
  aspectRatio: string | null;
  matchScore: number | null;
  isFallback: boolean;
  fallbackReason: string | null;
  photo?: PhotoRecord;
  cache?: QueryCacheRecord;
}

export const PhotoEntity = new EntitySchema<PhotoRecord>({
  name: "Photo",
  tableName: "photos",
  columns: {
    id: { type: "varchar", length: 191, primary: true },
    provider: { type: "varchar", length: 32, nullable: true },
    url: { type: "text" },
    title: { type: "text" },
    category: { type: "text" },
    aspectRatio: { name: "aspect_ratio", type: "varchar", length: 16 },
    dimensions: { type: "varchar", length: 64 },
    dominantColor: { name: "dominant_color", type: "varchar", length: 32 },
    authorName: { name: "author_name", type: "text", nullable: true },
    authorUsername: { name: "author_username", type: "text", nullable: true },
    authorLink: { name: "author_link", type: "text", nullable: true },
    downloadLocation: { name: "download_location", type: "text", nullable: true },
    firstSeenAt: { name: "first_seen_at", type: "bigint", transformer: epochMs },
    updatedAt: { name: "updated_at", type: "bigint", transformer: epochMs },
  },
});

export const QueryCacheEntity = new EntitySchema<QueryCacheRecord>({
  name: "QueryCache",
  tableName: "query_cache",
  columns: {
    id: { type: "integer", primary: true, generated: "increment" },
    // SHA-256 of cacheKey: fixed-length unique key that indexes portably (MySQL has index length limits)
    keyHash: { name: "key_hash", type: "varchar", length: 64, unique: true },
    cacheKey: { name: "cache_key", type: "text" },
    endpoint: { type: "varchar", length: 16 },
    provider: { type: "varchar", length: 32 },
    query: { type: "text" },
    page: { type: "integer" },
    perPage: { name: "per_page", type: "integer" },
    orientation: { type: "varchar", length: 16, nullable: true },
    color: { type: "varchar", length: 32, nullable: true },
    ratio: { type: "varchar", length: 16, nullable: true },
    resultProvider: { name: "result_provider", type: "varchar", length: 32 },
    isFallback: { name: "is_fallback", type: "boolean", default: false },
    warning: { type: "text", nullable: true },
    photoCount: { name: "photo_count", type: "integer", default: 0 },
    createdAt: { name: "created_at", type: "bigint", transformer: epochMs },
    expiresAt: { name: "expires_at", type: "bigint", transformer: epochMs },
    hitCount: { name: "hit_count", type: "integer", default: 0 },
    lastAccessedAt: { name: "last_accessed_at", type: "bigint", transformer: epochMs },
  },
});

export const QueryCachePhotoEntity = new EntitySchema<QueryCachePhotoRecord>({
  name: "QueryCachePhoto",
  tableName: "query_cache_photos",
  columns: {
    cacheId: { name: "cache_id", type: "integer", primary: true },
    position: { type: "integer", primary: true },
    photoId: { name: "photo_id", type: "varchar", length: 191 },
    provider: { type: "varchar", length: 32, nullable: true },
    aspectRatio: { name: "aspect_ratio", type: "varchar", length: 16, nullable: true },
    matchScore: { name: "match_score", type: "double precision", nullable: true, transformer: toNumber },
    isFallback: { name: "is_fallback", type: "boolean", default: false },
    fallbackReason: { name: "fallback_reason", type: "text", nullable: true },
  },
  relations: {
    cache: {
      type: "many-to-one",
      target: "QueryCache",
      joinColumn: { name: "cache_id" },
      onDelete: "CASCADE",
    },
    photo: {
      type: "many-to-one",
      target: "Photo",
      joinColumn: { name: "photo_id" },
      onDelete: "CASCADE",
    },
  },
});

export const CACHE_ENTITIES = [PhotoEntity, QueryCacheEntity, QueryCachePhotoEntity];
