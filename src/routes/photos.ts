import { Request, Response, Router } from "express";
import { CachedQueryResult, cachedPhotoService } from "../services/cachedPhotoService.js";
import { photoAggregator } from "../services/photoAggregator.js";
import { PhotoProvider } from "../types.js";

export const photosRouter = Router();

// Force a fresh upstream fetch with ?refresh=true or a `Cache-Control: no-cache` request header
function shouldBypassCache(req: Request): boolean {
  const refresh = String(req.query.refresh ?? "").toLowerCase();
  if (refresh === "true" || refresh === "1") return true;
  return /no-cache|no-store/i.test(req.get("cache-control") ?? "");
}

function applyCacheHeaders(res: Response, result: CachedQueryResult): void {
  res.setHeader("X-Cache", result.cache.status);
  if (result.cache.ageSeconds !== undefined) res.setHeader("Age", String(result.cache.ageSeconds));
  if (result.cache.reason) res.setHeader("X-Cache-Reason", result.cache.reason);
}

// 1. GET /api/photos/providers - Get status of all available stock providers
photosRouter.get("/providers", (_req: Request, res: Response) => {
  res.json({
    success: true,
    providers: photoAggregator.getProviderStatus(),
  });
});

// 2. GET /api/photos - Get curated feed photos (smart multi-provider aggregation)
photosRouter.get("/", async (req: Request, res: Response) => {
  try {
    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = parseInt(req.query.per_page as string, 10) || 24;
    const provider = (req.query.provider as PhotoProvider | "all") || "all";

    const result = await cachedPhotoService.getCurated({ page, perPage, provider }, shouldBypassCache(req));
    applyCacheHeaders(res, result);

    res.json({
      success: true,
      provider,
      count: result.photos.length,
      page,
      fallback: result.fallback,
      warning: result.warning,
      cache: result.cache,
      data: result.photos,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to fetch photos" });
  }
});

// 3. GET /api/photos/search - Search photos across providers
photosRouter.get("/search", async (req: Request, res: Response) => {
  try {
    const query = (req.query.q as string) || (req.query.query as string) || "";
    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = parseInt(req.query.per_page as string, 10) || 24;
    const provider = (req.query.provider as PhotoProvider | "all") || "all";
    const orientation = req.query.orientation as "landscape" | "portrait" | "squarish" | undefined;
    const color = req.query.color as string | undefined;

    const result = await cachedPhotoService.search(
      query,
      {
        page,
        perPage,
        provider,
        orientation,
        color,
      },
      shouldBypassCache(req)
    );
    applyCacheHeaders(res, result);

    res.json({
      success: true,
      query,
      provider,
      count: result.photos.length,
      page,
      fallback: result.fallback,
      warning: result.warning,
      cache: result.cache,
      data: result.photos,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Search failed" });
  }
});

// 4. GET /api/photos/ratio - Filter photos by ratio preset
photosRouter.get("/ratio", async (req: Request, res: Response) => {
  try {
    const ratio = (req.query.ratio as string) || "1:1";
    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = parseInt(req.query.per_page as string, 10) || 24;
    const provider = (req.query.provider as PhotoProvider | "all") || "all";

    const result = await cachedPhotoService.getByRatio(ratio, { page, perPage, provider }, shouldBypassCache(req));
    applyCacheHeaders(res, result);

    res.json({
      success: true,
      ratio,
      provider,
      count: result.photos.length,
      page,
      fallback: result.fallback,
      warning: result.warning,
      cache: result.cache,
      data: result.photos,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Ratio filter failed" });
  }
});

// 5. GET /api/photos/color - Filter photos by brand color with match scores
photosRouter.get("/color", async (req: Request, res: Response) => {
  try {
    const color = (req.query.color as string) || "#3E7CB1";
    const page = parseInt(req.query.page as string, 10) || 1;
    const perPage = parseInt(req.query.per_page as string, 10) || 24;
    const provider = (req.query.provider as PhotoProvider | "all") || "all";

    const result = await cachedPhotoService.getByColor(color, { page, perPage, provider }, shouldBypassCache(req));
    applyCacheHeaders(res, result);

    res.json({
      success: true,
      targetColor: color,
      provider,
      count: result.photos.length,
      page,
      fallback: result.fallback,
      warning: result.warning,
      cache: result.cache,
      data: result.photos,
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Color filter failed" });
  }
});

// 6. GET /api/photos/proxy-image - CORS-friendly binary proxy
photosRouter.get("/proxy-image", async (req: Request, res: Response) => {
  try {
    const imageUrl = req.query.url as string;
    if (!imageUrl) {
      res.status(400).json({ success: false, error: "Missing 'url' query parameter" });
      return;
    }

    const imageRes = await fetch(imageUrl);
    if (!imageRes.ok) {
      res.status(imageRes.status).send("Failed to fetch upstream image");
      return;
    }

    const contentType = imageRes.headers.get("content-type") || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "public, max-age=86400");

    const arrayBuffer = await imageRes.arrayBuffer();
    res.send(Buffer.from(arrayBuffer));
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || "Failed to proxy image" });
  }
});

// 7. POST /api/photos/track-download - Track download metrics
photosRouter.post("/track-download", async (req: Request, res: Response) => {
  try {
    const { downloadLocation } = req.body;
    if (downloadLocation) {
      await photoAggregator.trackDownload(downloadLocation);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
