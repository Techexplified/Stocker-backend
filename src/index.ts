import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { cacheRouter } from "./routes/cache.js";
import { photosRouter } from "./routes/photos.js";
import { cachedPhotoService } from "./services/cachedPhotoService.js";
import { photoAggregator } from "./services/photoAggregator.js";

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors({ origin: "*", exposedHeaders: ["X-Cache", "Age", "X-Cache-Reason"] }));
app.use(express.json());

let initPromise: Promise<void> | null = null;

export function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = cachedPhotoService.init().catch((err) => {
      console.warn("[Startup] Cache initialization warning:", err?.message || err);
    });
  }
  return initPromise;
}

// Ensure cache & background services are initialized before handling requests
app.use(async (_req, _res, next) => {
  try {
    await ensureInitialized();
  } catch {
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
  const status = photoAggregator.getProviderStatus();
  res.json({
    status: "ok",
    service: "Stocker Backend Multi-Provider API",
    providers: status,
    cache: {
      enabled: cachedPhotoService.isEnabled,
      active: cachedPhotoService.isActive,
      status: cachedPhotoService.status,
      engine: cachedPhotoService.engine,
      target: cachedPhotoService.target,
      error: cachedPhotoService.lastError,
    },
    timestamp: new Date().toISOString(),
  });
});

// Photo API Routes
app.use("/api/photos", photosRouter);

// Cache administration
app.use("/api/cache", cacheRouter);

let server: ReturnType<typeof app.listen> | null = null;

// Start Server (used in traditional Node environments; bypassed on Vercel)
async function start() {
  await ensureInitialized();

  server = app.listen(PORT, () => {
    const status = photoAggregator.getProviderStatus();
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
async function shutdown(signal: string) {
  console.log(`\n${signal} received, shutting down...`);
  if (server) {
    server.close(async () => {
      await cachedPhotoService.shutdown();
      process.exit(0);
    });
  } else {
    await cachedPhotoService.shutdown();
    process.exit(0);
  }
  setTimeout(async () => {
    await cachedPhotoService.shutdown();
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

export { app };
export default app;
