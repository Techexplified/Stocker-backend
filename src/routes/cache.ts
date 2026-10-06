import { NextFunction, Request, Response, Router } from "express";
import { cachedPhotoService } from "../services/cachedPhotoService.js";

export const cacheRouter = Router();

// Optional protection: if CACHE_ADMIN_TOKEN is set, mutating endpoints require `x-admin-token`
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = process.env.CACHE_ADMIN_TOKEN?.trim();
  if (token && req.get("x-admin-token") !== token) {
    res.status(401).json({ success: false, error: "Invalid or missing x-admin-token header" });
    return;
  }
  next();
}

// GET /api/cache/stats - Hit ratio, entry counts, storage size, top queries
cacheRouter.get("/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await cachedPhotoService.stats();
    res.json({ success: true, cache: stats });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to retrieve cache stats" });
  }
});

// DELETE /api/cache - Clear cache (optionally ?endpoint=search&provider=unsplash&q=dog)
cacheRouter.delete("/", requireAdmin, async (req: Request, res: Response) => {
  try {
    const removed = await cachedPhotoService.clear({
      endpoint: req.query.endpoint as string | undefined,
      provider: req.query.provider as string | undefined,
      query: req.query.q as string | undefined,
    });
    res.json({ success: true, removed });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to clear cache" });
  }
});

// POST /api/cache/purge - Run expiry purge + LRU eviction now
cacheRouter.post("/purge", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const result = await cachedPhotoService.runMaintenance();
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to run cache maintenance" });
  }
});
