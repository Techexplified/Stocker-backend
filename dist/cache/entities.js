"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_ENTITIES = exports.QueryCachePhotoEntity = exports.QueryCacheEntity = exports.PhotoEntity = void 0;
const typeorm_1 = require("typeorm");
/**
 * ORM entity definitions shared by SQLite, MySQL and PostgreSQL.
 *
 * EntitySchema (instead of decorators) keeps the models plain TypeScript and works with
 * both `tsc` and `tsx`/esbuild without `emitDecoratorMetadata`.
 *
 * Only column types supported by all three drivers are used. Epoch-millisecond timestamps
 * are stored as BIGINT and converted back to numbers (pg/mysql return BIGINT as strings).
 */
const epochMs = {
    to: (v) => v,
    from: (v) => (v === null || v === undefined ? null : Number(v)),
};
const toNumber = {
    to: (v) => v,
    from: (v) => (v === null || v === undefined ? null : Number(v)),
};
exports.PhotoEntity = new typeorm_1.EntitySchema({
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
exports.QueryCacheEntity = new typeorm_1.EntitySchema({
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
exports.QueryCachePhotoEntity = new typeorm_1.EntitySchema({
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
exports.CACHE_ENTITIES = [exports.PhotoEntity, exports.QueryCacheEntity, exports.QueryCachePhotoEntity];
