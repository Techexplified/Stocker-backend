"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultDbPath = getDefaultDbPath;
exports.openDatabase = openDatabase;
exports.getDatabase = getDatabase;
exports.closeDatabase = closeDatabase;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const MIGRATIONS = [
    {
        version: 1,
        name: "initial_cache_schema",
        sql: `
      CREATE TABLE IF NOT EXISTS photos (
        id                TEXT    PRIMARY KEY,
        provider          TEXT,
        url               TEXT    NOT NULL,
        title             TEXT    NOT NULL,
        category          TEXT    NOT NULL,
        aspect_ratio      TEXT    NOT NULL,
        dimensions        TEXT    NOT NULL,
        dominant_color    TEXT    NOT NULL,
        author_name       TEXT,
        author_username   TEXT,
        author_link       TEXT,
        download_location TEXT,
        first_seen_at     INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_photos_provider ON photos(provider);

      CREATE TABLE IF NOT EXISTS query_cache (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        cache_key       TEXT    NOT NULL UNIQUE,
        endpoint        TEXT    NOT NULL CHECK (endpoint IN ('curated', 'search', 'ratio', 'color')),
        provider        TEXT    NOT NULL,
        query           TEXT    NOT NULL DEFAULT '',
        page            INTEGER NOT NULL,
        per_page        INTEGER NOT NULL,
        orientation     TEXT,
        color           TEXT,
        ratio           TEXT,
        result_provider TEXT    NOT NULL,
        is_fallback     INTEGER NOT NULL DEFAULT 0,
        warning         TEXT,
        photo_count     INTEGER NOT NULL DEFAULT 0,
        created_at      INTEGER NOT NULL,
        expires_at      INTEGER NOT NULL,
        hit_count       INTEGER NOT NULL DEFAULT 0,
        last_hit_at     INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_query_cache_expires  ON query_cache(expires_at);
      CREATE INDEX IF NOT EXISTS idx_query_cache_endpoint ON query_cache(endpoint, provider);
      CREATE INDEX IF NOT EXISTS idx_query_cache_lru      ON query_cache(last_hit_at, created_at);

      CREATE TABLE IF NOT EXISTS query_cache_photos (
        cache_id        INTEGER NOT NULL REFERENCES query_cache(id) ON DELETE CASCADE,
        position        INTEGER NOT NULL,
        photo_id        TEXT    NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
        provider        TEXT,
        aspect_ratio    TEXT,
        match_score     REAL,
        is_fallback     INTEGER NOT NULL DEFAULT 0,
        fallback_reason TEXT,
        PRIMARY KEY (cache_id, position)
      );
      CREATE INDEX IF NOT EXISTS idx_query_cache_photos_photo ON query_cache_photos(photo_id);
    `,
    },
];
let db = null;
function getDefaultDbPath() {
    // Resolves to backend/data/ from both src/cache (tsx) and dist/cache (compiled)
    return node_path_1.default.resolve(__dirname, "../../data/stocker-cache.db");
}
function openDatabase(dbPath = getDefaultDbPath()) {
    if (db)
        return db;
    if (dbPath !== ":memory:") {
        node_fs_1.default.mkdirSync(node_path_1.default.dirname(dbPath), { recursive: true });
    }
    const conn = new better_sqlite3_1.default(dbPath);
    conn.pragma("journal_mode = WAL"); // concurrent readers while writing
    conn.pragma("synchronous = NORMAL"); // safe with WAL, much faster than FULL
    conn.pragma("foreign_keys = ON"); // enforce cascades on join table
    conn.pragma("busy_timeout = 3000");
    runMigrations(conn);
    db = conn;
    return conn;
}
function getDatabase() {
    return db;
}
function closeDatabase() {
    if (db) {
        try {
            db.close();
        }
        finally {
            db = null;
        }
    }
}
function runMigrations(conn) {
    conn.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT    NOT NULL,
      applied_at INTEGER NOT NULL
    );
  `);
    const applied = new Set(conn.prepare("SELECT version FROM schema_migrations").all().map((r) => r.version));
    const record = conn.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)");
    for (const m of MIGRATIONS) {
        if (applied.has(m.version))
            continue;
        conn.transaction(() => {
            conn.exec(m.sql);
            record.run(m.version, m.name, Date.now());
        })();
        console.log(`[Cache DB] Applied migration v${m.version}: ${m.name}`);
    }
}
