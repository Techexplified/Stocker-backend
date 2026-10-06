"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDefaultSqlitePath = getDefaultSqlitePath;
exports.isDatabaseConfigured = isDatabaseConfigured;
exports.buildCacheDbConfig = buildCacheDbConfig;
exports.initCacheDataSource = initCacheDataSource;
exports.testConnection = testConnection;
exports.closeCacheDataSource = closeCacheDataSource;
require("reflect-metadata");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const typeorm_1 = require("typeorm");
const entities_js_1 = require("./entities.js");
const _1759670000000_CreateCacheSchema_js_1 = require("./migrations/1759670000000-CreateCacheSchema.js");
function getDefaultSqlitePath() {
    // Resolves to backend/data/ from both src/cache (tsx) and dist/cache (compiled)
    return node_path_1.default.resolve(__dirname, "../../data/stocker-cache.db");
}
/** Determines if database configuration environment variables are provided. */
function isDatabaseConfigured(env = process.env) {
    if ((env.CACHE_ENABLED ?? "true").toLowerCase() === "false") {
        return false;
    }
    return Boolean(env.CACHE_DB_URL?.trim() ||
        env.CACHE_DB_TYPE?.trim() ||
        env.CACHE_DB_HOST?.trim() ||
        env.CACHE_DB_PATH?.trim());
}
function parseType(raw, url, env) {
    const value = (raw || "").trim().toLowerCase();
    if (["postgres", "postgresql", "pg"].includes(value))
        return "postgres";
    if (["mysql", "mariadb"].includes(value))
        return "mysql";
    if (["sqlite", "sqlite3", "better-sqlite3"].includes(value))
        return "sqlite";
    if (value)
        throw new Error(`Unsupported CACHE_DB_TYPE "${raw}" (use sqlite, mysql or postgres)`);
    // Infer from URL scheme
    if (url?.startsWith("postgres"))
        return "postgres";
    if (url?.startsWith("mysql") || url?.startsWith("mariadb"))
        return "mysql";
    if (url?.startsWith("sqlite"))
        return "sqlite";
    // Infer from discrete variables
    if (env.CACHE_DB_PATH)
        return "sqlite";
    if (env.CACHE_DB_PORT === "3306")
        return "mysql";
    if (env.CACHE_DB_PORT === "5432")
        return "postgres";
    return "sqlite";
}
function redact(url) {
    try {
        const u = new URL(url);
        if (u.password)
            u.password = "****";
        return u.toString();
    }
    catch {
        return url.replace(/\/\/([^:]+):[^@]+@/, "//$1:****@");
    }
}
/** Builds TypeORM options from CACHE_DB_* environment variables. */
function buildCacheDbConfig(env = process.env) {
    if (!isDatabaseConfigured(env)) {
        return {
            configured: false,
            type: "none",
            target: "none",
        };
    }
    const url = env.CACHE_DB_URL?.trim() || undefined;
    const type = parseType(env.CACHE_DB_TYPE, url, env);
    const logging = (env.CACHE_DB_LOGGING ?? "").toLowerCase() === "true" ? true : ["error", "warn"];
    const common = {
        entities: entities_js_1.CACHE_ENTITIES,
        migrations: [_1759670000000_CreateCacheSchema_js_1.CreateCacheSchema1759670000000],
        migrationsTableName: "cache_migrations",
        migrationsRun: true, // apply pending schema migrations on startup
        synchronize: false, // never auto-alter tables; migrations are the source of truth
        logging: [...(logging === true ? ["query", "error", "warn"] : logging)],
    };
    if (type === "sqlite") {
        let dbPath = env.CACHE_DB_PATH?.trim();
        if (!dbPath) {
            dbPath = process.env.VERCEL ? "/tmp/stocker-cache.db" : getDefaultSqlitePath();
        }
        if (dbPath !== ":memory:") {
            try {
                node_fs_1.default.mkdirSync(node_path_1.default.dirname(dbPath), { recursive: true });
            }
            catch (err) {
                console.warn(`[Cache] Warning: Could not create directory for SQLite DB:`, err?.message);
            }
        }
        return {
            configured: true,
            type,
            target: `sqlite://${dbPath}`,
            options: {
                ...common,
                type: "better-sqlite3",
                database: dbPath,
                enableWAL: !process.env.VERCEL, // WAL on disk, standard on Vercel ephemeral
                prepareDatabase: (db) => {
                    db.pragma("synchronous = NORMAL");
                    db.pragma("busy_timeout = 3000");
                },
            },
        };
    }
    const defaultPool = process.env.VERCEL ? 3 : 10;
    const poolSize = parseInt(env.CACHE_DB_POOL_SIZE ?? "", 10) || defaultPool;
    const sslEnabled = (env.CACHE_DB_SSL ?? "").toLowerCase() === "true" || Boolean(process.env.VERCEL && url?.includes("sslmode=require"));
    const ssl = sslEnabled
        ? { rejectUnauthorized: (env.CACHE_DB_SSL_REJECT_UNAUTHORIZED ?? "true").toLowerCase() !== "false" }
        : undefined;
    const defaultPort = type === "postgres" ? 5432 : 3306;
    const host = env.CACHE_DB_HOST?.trim() || "localhost";
    const port = parseInt(env.CACHE_DB_PORT ?? "", 10) || defaultPort;
    const username = env.CACHE_DB_USER?.trim() || (type === "postgres" ? "postgres" : "root");
    const database = env.CACHE_DB_NAME?.trim() || "stocker_cache";
    const connection = url
        ? { url }
        : { host, port, username, password: env.CACHE_DB_PASSWORD ?? "", database };
    const target = url ? redact(url) : `${type}://${username}@${host}:${port}/${database}`;
    if (type === "postgres") {
        return {
            configured: true,
            type,
            target,
            options: {
                ...common,
                ...connection,
                type: "postgres",
                ssl,
                poolSize,
                connectTimeoutMS: 5000,
                applicationName: "stocker-backend",
            },
        };
    }
    return {
        configured: true,
        type,
        target,
        options: {
            ...common,
            ...connection,
            type: "mysql", // mysql2 driver; also works with MariaDB
            charset: "utf8mb4",
            ssl,
            poolSize,
            connectTimeout: 5000,
            supportBigNumbers: true,
            bigNumberStrings: false,
        },
    };
}
let dataSource = null;
/** Connects (and runs migrations). Throws if the database is unreachable. */
async function initCacheDataSource(config) {
    if (!config.configured || !config.options)
        return null;
    if (dataSource?.isInitialized)
        return dataSource;
    const ds = new typeorm_1.DataSource(config.options);
    await ds.initialize();
    dataSource = ds;
    return ds;
}
async function testConnection(ds) {
    try {
        if (!ds || !ds.isInitialized)
            return false;
        await ds.query("SELECT 1");
        return true;
    }
    catch {
        return false;
    }
}
async function closeCacheDataSource() {
    const ds = dataSource;
    dataSource = null;
    if (ds?.isInitialized) {
        try {
            await ds.destroy();
        }
        catch {
            /* ignore close errors on dead connection */
        }
    }
}
