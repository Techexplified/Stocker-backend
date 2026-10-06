"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unsplashProvider = exports.UnsplashProvider = void 0;
const colorAndRatio_js_1 = require("../../utils/colorAndRatio.js");
const healthTracker_js_1 = require("../../utils/healthTracker.js");
const UNSPLASH_BASE_URL = "https://api.unsplash.com";
class UnsplashProvider {
    health = new healthTracker_js_1.ProviderHealthTracker("Unsplash");
    get isConfigured() {
        const key = process.env.UNSPLASH_ACCESS_KEY?.trim();
        return !!key && key.length > 10;
    }
    getStatus() {
        return this.health.getStatus(this.isConfigured);
    }
    get headers() {
        return {
            Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY?.trim()}`,
            "Accept-Version": "v1",
        };
    }
    mapPhoto(photo, targetColor) {
        const dominantColor = photo.color?.startsWith("#") ? photo.color : `#${photo.color || "3E7CB1"}`;
        const primaryTag = photo.tags && photo.tags.length > 0 ? photo.tags[0].title : "photo";
        return {
            id: `unsplash-${photo.id}`,
            url: photo.urls.regular || photo.urls.small || photo.urls.full,
            title: photo.alt_description ||
                photo.description ||
                (primaryTag ? `${primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1)} Photo` : "Unsplash Photo"),
            category: primaryTag.toLowerCase(),
            aspectRatio: (0, colorAndRatio_js_1.calculateAspectRatio)(photo.width, photo.height),
            dimensions: `${photo.width} × ${photo.height}`,
            dominantColor,
            matchScore: targetColor ? (0, colorAndRatio_js_1.calculateColorMatch)(dominantColor, targetColor) : undefined,
            provider: "unsplash",
            author: {
                name: photo.user.name,
                username: photo.user.username,
                link: `${photo.user.links?.html || `https://unsplash.com/@${photo.user.username}`}?utm_source=stocker_figma_plugin&utm_medium=referral`,
            },
            downloadLocation: photo.links?.download_location,
        };
    }
    async getCurated(page = 1, perPage = 20) {
        if (!this.isConfigured || this.health.isCircuitOpen)
            return [];
        try {
            const res = await fetch(`${UNSPLASH_BASE_URL}/photos?page=${page}&per_page=${perPage}&order_by=popular`, { headers: this.headers, signal: AbortSignal.timeout(5000) });
            if (!res.ok) {
                const errorMsg = res.status === 401
                    ? "Invalid Unsplash access key"
                    : res.status === 403
                        ? "Unsplash rate limit reached or access forbidden"
                        : res.status === 429
                            ? "Unsplash rate limit exceeded"
                            : `Unsplash returned HTTP ${res.status}`;
                this.health.recordFailure(errorMsg);
                return [];
            }
            const data = (await res.json());
            this.health.recordSuccess();
            return data.map((p) => this.mapPhoto(p));
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
            const url = new URL(`${UNSPLASH_BASE_URL}/search/photos`);
            url.searchParams.append("query", query || "aesthetic");
            url.searchParams.append("page", String(page));
            url.searchParams.append("per_page", String(perPage));
            if (orientation)
                url.searchParams.append("orientation", orientation);
            if (color) {
                url.searchParams.append("color", (0, colorAndRatio_js_1.hexToColorName)(color));
            }
            const res = await fetch(url.toString(), {
                headers: this.headers,
                signal: AbortSignal.timeout(5000),
            });
            if (!res.ok) {
                const errorMsg = res.status === 401
                    ? "Invalid Unsplash access key"
                    : res.status === 403
                        ? "Unsplash rate limit reached or access forbidden"
                        : res.status === 429
                            ? "Unsplash rate limit exceeded"
                            : `Unsplash returned HTTP ${res.status}`;
                this.health.recordFailure(errorMsg);
                return [];
            }
            const data = (await res.json());
            this.health.recordSuccess();
            return (data.results || []).map((p) => this.mapPhoto(p, color));
        }
        catch (err) {
            const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
            const errorMsg = isTimeout ? "Request timed out after 5s" : err.message || "Network error";
            this.health.recordFailure(errorMsg);
            return [];
        }
    }
    async trackDownload(downloadLocation) {
        if (!this.isConfigured || !downloadLocation)
            return;
        try {
            await fetch(downloadLocation, { headers: this.headers, signal: AbortSignal.timeout(4000) });
        }
        catch {
            // background fire-and-forget
        }
    }
}
exports.UnsplashProvider = UnsplashProvider;
exports.unsplashProvider = new UnsplashProvider();
