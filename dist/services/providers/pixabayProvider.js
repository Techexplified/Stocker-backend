"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pixabayProvider = exports.PixabayProvider = void 0;
const colorAndRatio_js_1 = require("../../utils/colorAndRatio.js");
const healthTracker_js_1 = require("../../utils/healthTracker.js");
const PIXABAY_BASE_URL = "https://pixabay.com/api/";
class PixabayProvider {
    health = new healthTracker_js_1.ProviderHealthTracker("Pixabay");
    get isConfigured() {
        const key = process.env.PIXABAY_API_KEY?.trim();
        return !!key && key.length > 8;
    }
    getStatus() {
        return this.health.getStatus(this.isConfigured);
    }
    mapHit(hit, targetColor) {
        const tags = hit.tags ? hit.tags.split(",").map((t) => t.trim()) : ["photo"];
        const primaryTag = tags[0] || "photo";
        const title = primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1) + " (Pixabay)";
        const dominantColor = targetColor || "#3E7CB1";
        return {
            id: `pixabay-${hit.id}`,
            url: hit.largeImageURL || hit.webformatURL,
            title,
            category: primaryTag.toLowerCase(),
            aspectRatio: (0, colorAndRatio_js_1.calculateAspectRatio)(hit.imageWidth, hit.imageHeight),
            dimensions: `${hit.imageWidth} × ${hit.imageHeight}`,
            dominantColor,
            matchScore: targetColor ? (0, colorAndRatio_js_1.calculateColorMatch)(dominantColor, targetColor) : undefined,
            provider: "pixabay",
            author: {
                name: hit.user || "Pixabay Creator",
                username: hit.user || "pixabay",
                link: hit.pageURL,
            },
        };
    }
    async getCurated(page = 1, perPage = 20) {
        if (!this.isConfigured || this.health.isCircuitOpen)
            return [];
        try {
            const key = process.env.PIXABAY_API_KEY?.trim();
            const url = new URL(PIXABAY_BASE_URL);
            url.searchParams.append("key", key || "");
            url.searchParams.append("image_type", "photo");
            url.searchParams.append("order", "popular");
            url.searchParams.append("safesearch", "true");
            url.searchParams.append("page", String(page));
            url.searchParams.append("per_page", String(perPage));
            const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
            if (!res.ok) {
                const errorMsg = res.status === 400 || res.status === 401
                    ? "Invalid Pixabay API key"
                    : res.status === 429
                        ? "Pixabay rate limit exceeded"
                        : `Pixabay returned HTTP ${res.status}`;
                this.health.recordFailure(errorMsg);
                return [];
            }
            const data = (await res.json());
            this.health.recordSuccess();
            return (data.hits || []).map((h) => this.mapHit(h));
        }
        catch (err) {
            const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
            const errorMsg = isTimeout ? "Request timed out after 5s" : err.message || "Network error";
            this.health.recordFailure(errorMsg);
            return [];
        }
    }
    async search(query, options = {}) {
        if (!this.isConfigured || this.health.isCircuitOpen)
            return [];
        try {
            const { page = 1, perPage = 20, orientation, color } = options;
            const key = process.env.PIXABAY_API_KEY?.trim();
            const url = new URL(PIXABAY_BASE_URL);
            url.searchParams.append("key", key || "");
            url.searchParams.append("q", query || "wallpaper");
            url.searchParams.append("image_type", "photo");
            url.searchParams.append("safesearch", "true");
            url.searchParams.append("page", String(page));
            url.searchParams.append("per_page", String(perPage));
            if (orientation) {
                if (orientation === "landscape")
                    url.searchParams.append("orientation", "horizontal");
                else if (orientation === "portrait")
                    url.searchParams.append("orientation", "vertical");
            }
            if (color) {
                const colorName = (0, colorAndRatio_js_1.hexToColorName)(color);
                url.searchParams.append("colors", colorName);
            }
            const res = await fetch(url.toString(), { signal: AbortSignal.timeout(5000) });
            if (!res.ok) {
                const errorMsg = res.status === 400 || res.status === 401
                    ? "Invalid Pixabay API key"
                    : res.status === 429
                        ? "Pixabay rate limit exceeded"
                        : `Pixabay returned HTTP ${res.status}`;
                this.health.recordFailure(errorMsg);
                return [];
            }
            const data = (await res.json());
            this.health.recordSuccess();
            return (data.hits || []).map((h) => this.mapHit(h, color));
        }
        catch (err) {
            const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
            const errorMsg = isTimeout ? "Request timed out after 5s" : err.message || "Network error";
            this.health.recordFailure(errorMsg);
            return [];
        }
    }
}
exports.PixabayProvider = PixabayProvider;
exports.pixabayProvider = new PixabayProvider();
