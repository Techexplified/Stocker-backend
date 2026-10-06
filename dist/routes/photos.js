"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.photosRouter = void 0;
const express_1 = require("express");
const cachedPhotoService_js_1 = require("../services/cachedPhotoService.js");
const photoAggregator_js_1 = require("../services/photoAggregator.js");
exports.photosRouter = (0, express_1.Router)();
// Force a fresh upstream fetch with ?refresh=true or a `Cache-Control: no-cache` request header
function shouldBypassCache(req) {
    const refresh = String(req.query.refresh ?? "").toLowerCase();
    if (refresh === "true" || refresh === "1")
        return true;
    return /no-cache|no-store/i.test(req.get("cache-control") ?? "");
}
function applyCacheHeaders(res, result) {
    res.setHeader("X-Cache", result.cache.status);
    if (result.cache.ageSeconds !== undefined)
        res.setHeader("Age", String(result.cache.ageSeconds));
    if (result.cache.reason)
        res.setHeader("X-Cache-Reason", result.cache.reason);
}
// 1. GET /api/photos/providers - Get status of all available stock providers
exports.photosRouter.get("/providers", (_req, res) => {
    res.json({
        success: true,
        providers: photoAggregator_js_1.photoAggregator.getProviderStatus(),
    });
});
// 2. GET /api/photos - Get curated feed photos (smart multi-provider aggregation)
exports.photosRouter.get("/", async (req, res) => {
    try {
        const page = parseInt(req.query.page, 10) || 1;
        const perPage = parseInt(req.query.per_page, 10) || 24;
        const provider = req.query.provider || "all";
        const result = await cachedPhotoService_js_1.cachedPhotoService.getCurated({ page, perPage, provider }, shouldBypassCache(req));
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Failed to fetch photos" });
    }
});
// 3. GET /api/photos/search - Search photos across providers
exports.photosRouter.get("/search", async (req, res) => {
    try {
        const query = req.query.q || req.query.query || "";
        const page = parseInt(req.query.page, 10) || 1;
        const perPage = parseInt(req.query.per_page, 10) || 24;
        const provider = req.query.provider || "all";
        const orientation = req.query.orientation;
        const color = req.query.color;
        const result = await cachedPhotoService_js_1.cachedPhotoService.search(query, {
            page,
            perPage,
            provider,
            orientation,
            color,
        }, shouldBypassCache(req));
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Search failed" });
    }
});
// 4. GET /api/photos/ratio - Filter photos by ratio preset
exports.photosRouter.get("/ratio", async (req, res) => {
    try {
        const ratio = req.query.ratio || "1:1";
        const page = parseInt(req.query.page, 10) || 1;
        const perPage = parseInt(req.query.per_page, 10) || 24;
        const provider = req.query.provider || "all";
        const result = await cachedPhotoService_js_1.cachedPhotoService.getByRatio(ratio, { page, perPage, provider }, shouldBypassCache(req));
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Ratio filter failed" });
    }
});
// 5. GET /api/photos/color - Filter photos by brand color with match scores
exports.photosRouter.get("/color", async (req, res) => {
    try {
        const color = req.query.color || "#3E7CB1";
        const page = parseInt(req.query.page, 10) || 1;
        const perPage = parseInt(req.query.per_page, 10) || 24;
        const provider = req.query.provider || "all";
        const result = await cachedPhotoService_js_1.cachedPhotoService.getByColor(color, { page, perPage, provider }, shouldBypassCache(req));
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Color filter failed" });
    }
});
// 6. GET /api/photos/proxy-image - CORS-friendly binary proxy
exports.photosRouter.get("/proxy-image", async (req, res) => {
    try {
        const imageUrl = req.query.url;
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
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Failed to proxy image" });
    }
});
// 7. POST /api/photos/track-download - Track download metrics
exports.photosRouter.post("/track-download", async (req, res) => {
    try {
        const { downloadLocation } = req.body;
        if (downloadLocation) {
            await photoAggregator_js_1.photoAggregator.trackDownload(downloadLocation);
        }
        res.json({ success: true });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
