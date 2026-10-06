"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
exports.ensureInitialized = ensureInitialized;
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const express_1 = __importDefault(require("express"));
const cache_js_1 = require("./routes/cache.js");
const photos_js_1 = require("./routes/photos.js");
const cachedPhotoService_js_1 = require("./services/cachedPhotoService.js");
const photoAggregator_js_1 = require("./services/photoAggregator.js");
// Load environment variables
dotenv_1.default.config();
const app = (0, express_1.default)();
exports.app = app;
const PORT = process.env.PORT || 3001;
// Middlewares
app.use((0, cors_1.default)({ origin: "*", exposedHeaders: ["X-Cache", "Age", "X-Cache-Reason"] }));
app.use(express_1.default.json());
let initPromise = null;
function ensureInitialized() {
    if (!initPromise) {
        initPromise = cachedPhotoService_js_1.cachedPhotoService.init().catch((err) => {
            console.warn("[Startup] Cache initialization warning:", err?.message || err);
        });
    }
    return initPromise;
}
// Ensure cache & background services are initialized before handling requests
app.use(async (_req, _res, next) => {
    try {
        await ensureInitialized();
    }
    catch {
        // Fail open: continue even if cache init reports a warning
    }
    next();
});
// Root Landing & Ping Endpoint
app.get("/", (_req, res) => {
    res.json({
        service: "Stocker Backend Multi-Provider API",
        status: "ok",
        version: "1.0.0",
        docs: {
            health: "/api/health",
            photos: "/api/photos",
            providers: "/api/photos/providers",
            cacheStats: "/api/cache/stats",
        },
    });
});
app.get("/health", (_req, res) => {
    res.redirect("/api/health");
});
// Health Check Endpoint
app.get("/api/health", (_req, res) => {
    const status = photoAggregator_js_1.photoAggregator.getProviderStatus();
    res.json({
        status: "ok",
        service: "Stocker Backend Multi-Provider API",
        providers: status,
        cache: {
            enabled: cachedPhotoService_js_1.cachedPhotoService.isEnabled,
            active: cachedPhotoService_js_1.cachedPhotoService.isActive,
            status: cachedPhotoService_js_1.cachedPhotoService.status,
            engine: cachedPhotoService_js_1.cachedPhotoService.engine,
            target: cachedPhotoService_js_1.cachedPhotoService.target,
            error: cachedPhotoService_js_1.cachedPhotoService.lastError,
        },
        timestamp: new Date().toISOString(),
    });
});
// Photo API Routes
app.use("/api/photos", photos_js_1.photosRouter);
// Cache administration
app.use("/api/cache", cache_js_1.cacheRouter);
let server = null;
// Start Server (used in traditional Node environments; bypassed on Vercel)
async function start() {
    await ensureInitialized();
    server = app.listen(PORT, () => {
        const status = photoAggregator_js_1.photoAggregator.getProviderStatus();
        console.log(`\n🚀 Stocker Multi-Provider Backend running on: http://localhost:${PORT}`);
        console.log(`📡 Health Check: http://localhost:${PORT}/api/health`);
        console.log(`🖼️  Photos API:   http://localhost:${PORT}/api/photos`);
        console.log(`📊 Cache Stats:  http://localhost:${PORT}/api/cache/stats`);
        console.log(`\n📦 Connected Providers:`);
        console.log(`   • Unsplash:     ${status.unsplash.available ? "✅ Live API Key active" : "ℹ️  Key omitted (Fallback mode)"}`);
        console.log(`   • Pexels:       ${status.pexels.available ? "✅ Live API Key active" : "ℹ️  Key omitted (Fallback mode)"}`);
        console.log(`   • Pixabay:      ${status.pixabay.available ? "✅ Live API Key active" : "ℹ️  Key omitted (Fallback mode)"}`);
        console.log(`   • Lorem Picsum: ✅ Active (Public & Keyless)\n`);
    });
}
// Graceful shutdown: flush WAL/pool and close the database cleanly
async function shutdown(signal) {
    console.log(`\n${signal} received, shutting down...`);
    if (server) {
        server.close(async () => {
            await cachedPhotoService_js_1.cachedPhotoService.shutdown();
            process.exit(0);
        });
    }
    else {
        await cachedPhotoService_js_1.cachedPhotoService.shutdown();
        process.exit(0);
    }
    setTimeout(async () => {
        await cachedPhotoService_js_1.cachedPhotoService.shutdown();
        process.exit(0);
    }, 3000).unref();
}
// In serverless environments (e.g., Vercel), app.listen is omitted and requests are dispatched by the serverless runtime
if (!process.env.VERCEL) {
    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    start().catch((err) => {
        console.error("Fatal startup error:", err);
        process.exit(1);
    });
}
exports.default = app;
