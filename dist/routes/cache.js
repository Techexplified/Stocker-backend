"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cacheRouter = void 0;
const express_1 = require("express");
const cachedPhotoService_js_1 = require("../services/cachedPhotoService.js");
exports.cacheRouter = (0, express_1.Router)();
// Optional protection: if CACHE_ADMIN_TOKEN is set, mutating endpoints require `x-admin-token`
function requireAdmin(req, res, next) {
    const token = process.env.CACHE_ADMIN_TOKEN?.trim();
    if (token && req.get("x-admin-token") !== token) {
        res.status(401).json({ success: false, error: "Invalid or missing x-admin-token header" });
        return;
    }
    next();
}
// GET /api/cache/stats - Hit ratio, entry counts, storage size, top queries
exports.cacheRouter.get("/stats", async (_req, res) => {
    try {
        const stats = await cachedPhotoService_js_1.cachedPhotoService.stats();
        res.json({ success: true, cache: stats });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Failed to retrieve cache stats" });
    }
});
// DELETE /api/cache - Clear cache (optionally ?endpoint=search&provider=unsplash&q=dog)
exports.cacheRouter.delete("/", requireAdmin, async (req, res) => {
    try {
        const removed = await cachedPhotoService_js_1.cachedPhotoService.clear({
            endpoint: req.query.endpoint,
            provider: req.query.provider,
            query: req.query.q,
        });
        res.json({ success: true, removed });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Failed to clear cache" });
    }
});
// POST /api/cache/purge - Run expiry purge + LRU eviction now
exports.cacheRouter.post("/purge", requireAdmin, async (_req, res) => {
    try {
        const result = await cachedPhotoService_js_1.cachedPhotoService.runMaintenance();
        res.json({ success: true, result });
    }
    catch (err) {
        res.status(500).json({ success: false, error: err.message || "Failed to run cache maintenance" });
    }
});
