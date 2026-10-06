"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.unsplashService = exports.UnsplashService = void 0;
exports.calculateAspectRatio = calculateAspectRatio;
exports.calculateColorMatch = calculateColorMatch;
exports.mapUnsplashToStockImage = mapUnsplashToStockImage;
const fallbackPhotos_js_1 = require("../data/fallbackPhotos.js");
const UNSPLASH_BASE_URL = "https://api.unsplash.com";
// Helper: Calculate closest standard aspect ratio
function calculateAspectRatio(width, height) {
    if (!width || !height)
        return "1:1";
    const ratio = width / height;
    if (Math.abs(ratio - 1) < 0.08)
        return "1:1";
    if (Math.abs(ratio - 0.8) < 0.08)
        return "4:5";
    if (Math.abs(ratio - 1.777) < 0.12)
        return "16:9";
    if (Math.abs(ratio - 0.5625) < 0.1)
        return "9:16";
    if (Math.abs(ratio - 1.333) < 0.08)
        return "4:3";
    if (Math.abs(ratio - 0.75) < 0.08)
        return "3:4";
    if (Math.abs(ratio - 1.5) < 0.08)
        return "3:2";
    if (Math.abs(ratio - 0.666) < 0.08)
        return "2:3";
    if (Math.abs(ratio - 1.91) < 0.12)
        return "1.91:1";
    if (Math.abs(ratio - 2.33) < 0.15)
        return "21:9";
    return ratio > 1
        ? `${Math.round(ratio * 10) / 10}:1`
        : `1:${Math.round((1 / ratio) * 10) / 10}`;
}
// Helper: Calculate color similarity percentage (0-100) between two HEX colors
function calculateColorMatch(hex1, hex2) {
    try {
        const parse = (h) => {
            const clean = h.replace("#", "");
            return {
                r: parseInt(clean.substring(0, 2), 16) || 0,
                g: parseInt(clean.substring(2, 4), 16) || 0,
                b: parseInt(clean.substring(4, 6), 16) || 0,
            };
        };
        const c1 = parse(hex1);
        const c2 = parse(hex2);
        // Euclidean distance in RGB color space
        const dist = Math.sqrt(Math.pow(c1.r - c2.r, 2) + Math.pow(c1.g - c2.g, 2) + Math.pow(c1.b - c2.b, 2));
        const maxDist = Math.sqrt(3 * Math.pow(255, 2)); // ~441.67
        const score = Math.max(70, Math.round((1 - dist / maxDist) * 100));
        return score;
    }
    catch {
        return 90;
    }
}
// Convert raw Unsplash Photo to StockImage
function mapUnsplashToStockImage(photo, targetColor) {
    const dominantColor = photo.color?.startsWith("#") ? photo.color : `#${photo.color || "3E7CB1"}`;
    const matchScore = targetColor ? calculateColorMatch(dominantColor, targetColor) : undefined;
    const primaryTag = photo.tags && photo.tags.length > 0 ? photo.tags[0].title : "photo";
    return {
        id: photo.id,
        url: photo.urls.regular || photo.urls.small || photo.urls.full,
        title: photo.alt_description ||
            photo.description ||
            (primaryTag ? `${primaryTag.charAt(0).toUpperCase() + primaryTag.slice(1)} Photo` : "Unsplash Photo"),
        category: primaryTag.toLowerCase(),
        aspectRatio: calculateAspectRatio(photo.width, photo.height),
        dimensions: `${photo.width} × ${photo.height}`,
        dominantColor,
        matchScore,
        author: {
            name: photo.user.name,
            username: photo.user.username,
            link: photo.user.links?.html || `https://unsplash.com/@${photo.user.username}`,
        },
        downloadLocation: photo.links?.download_location,
    };
}
class UnsplashService {
    accessKey;
    constructor() {
        this.accessKey = process.env.UNSPLASH_ACCESS_KEY?.trim();
    }
    isKeyValid() {
        return !!this.accessKey && this.accessKey.length > 10;
    }
    // 1. Get Curated / Editorial Photos
    async getCuratedPhotos(page = 1, perPage = 24) {
        if (!this.isKeyValid()) {
            return this.paginateFallback(fallbackPhotos_js_1.FALLBACK_PHOTOS, page, perPage);
        }
        try {
            const response = await fetch(`${UNSPLASH_BASE_URL}/photos?page=${page}&per_page=${perPage}&order_by=popular`, {
                headers: {
                    Authorization: `Client-ID ${this.accessKey}`,
                    "Accept-Version": "v1",
                },
            });
            if (!response.ok) {
                console.warn(`Unsplash API error (${response.status}), falling back to curated library`);
                return this.paginateFallback(fallbackPhotos_js_1.FALLBACK_PHOTOS, page, perPage);
            }
            const data = (await response.json());
            return data.map((p) => mapUnsplashToStockImage(p));
        }
        catch (error) {
            console.error("Error fetching curated photos from Unsplash:", error);
            return this.paginateFallback(fallbackPhotos_js_1.FALLBACK_PHOTOS, page, perPage);
        }
    }
    // 2. Search Photos by Query
    async searchPhotos(query, options = {}) {
        const { page = 1, perPage = 24, orientation, color } = options;
        if (!this.isKeyValid()) {
            return this.filterFallback(query, orientation, color, page, perPage);
        }
        try {
            const url = new URL(`${UNSPLASH_BASE_URL}/search/photos`);
            url.searchParams.append("query", query);
            url.searchParams.append("page", String(page));
            url.searchParams.append("per_page", String(perPage));
            if (orientation)
                url.searchParams.append("orientation", orientation);
            if (color)
                url.searchParams.append("color", color);
            const response = await fetch(url.toString(), {
                headers: {
                    Authorization: `Client-ID ${this.accessKey}`,
                    "Accept-Version": "v1",
                },
            });
            if (!response.ok) {
                console.warn(`Unsplash search error (${response.status}), using fallback`);
                return this.filterFallback(query, orientation, color, page, perPage);
            }
            const data = (await response.json());
            return (data.results || []).map((p) => mapUnsplashToStockImage(p, color));
        }
        catch (error) {
            console.error("Error searching photos on Unsplash:", error);
            return this.filterFallback(query, orientation, color, page, perPage);
        }
    }
    // 3. Filter Photos by Aspect Ratio Preset (e.g. 1:1, 4:5, 16:9, etc.)
    async getPhotosByRatio(ratio, page = 1, perPage = 24) {
        let orientation;
        if (ratio === "1:1")
            orientation = "squarish";
        else if (ratio === "4:5" || ratio === "9:16" || ratio === "3:4" || ratio === "2:3")
            orientation = "portrait";
        else if (ratio === "16:9" || ratio === "1.91:1" || ratio === "3:2" || ratio === "4:3")
            orientation = "landscape";
        const photos = await this.searchPhotos(ratio === "1:1" ? "square" : "photo", {
            page,
            perPage,
            orientation,
        });
        // Re-tag aspect ratio property so UI matches exactly
        return photos.map((p) => ({
            ...p,
            aspectRatio: ratio,
        }));
    }
    // 4. Filter Photos by Brand Color
    async getPhotosByColor(hexColor, page = 1, perPage = 24) {
        const unsplashColorName = this.hexToUnsplashColorName(hexColor);
        const photos = await this.searchPhotos(unsplashColorName || "aesthetic", {
            page,
            perPage,
            color: unsplashColorName,
        });
        // Calculate match scores against the target brand hex
        return photos
            .map((p) => ({
            ...p,
            matchScore: calculateColorMatch(p.dominantColor, hexColor),
        }))
            .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
    }
    // 5. Track Download (Required by Unsplash API Guidelines)
    async trackDownload(downloadLocation) {
        if (!this.isKeyValid() || !downloadLocation)
            return true;
        try {
            await fetch(downloadLocation, {
                headers: {
                    Authorization: `Client-ID ${this.accessKey}`,
                    "Accept-Version": "v1",
                },
            });
            return true;
        }
        catch (err) {
            console.warn("Failed to trigger download tracking:", err);
            return false;
        }
    }
    // Helper: Map hex code to closest Unsplash API color parameter
    hexToUnsplashColorName(hex) {
        const clean = hex.replace("#", "").toLowerCase();
        const r = parseInt(clean.substring(0, 2), 16) || 0;
        const g = parseInt(clean.substring(2, 4), 16) || 0;
        const b = parseInt(clean.substring(4, 6), 16) || 0;
        // Detect general hue
        if (r > 200 && g > 200 && b > 200)
            return "white";
        if (r < 40 && g < 40 && b < 40)
            return "black";
        if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20)
            return "black_and_white";
        if (b > r && b > g) {
            return g > 130 ? "teal" : "blue";
        }
        if (g > r && g > b)
            return "green";
        if (r > g && r > b) {
            if (b > 100)
                return "purple";
            if (g > 150)
                return "yellow";
            if (g > 70)
                return "orange";
            return "red";
        }
        return undefined;
    }
    // Fallback pagination & search
    paginateFallback(items, page, perPage) {
        const start = (page - 1) * perPage;
        return items.slice(start, start + perPage);
    }
    filterFallback(query, orientation, color, page = 1, perPage = 24) {
        let filtered = fallbackPhotos_js_1.FALLBACK_PHOTOS;
        if (query && query.trim() !== "" && query.toLowerCase() !== "photo") {
            const q = query.toLowerCase().trim();
            filtered = filtered.filter((img) => img.title.toLowerCase().includes(q) ||
                img.category.toLowerCase().includes(q));
        }
        if (filtered.length === 0) {
            // If query had no exact match, return all fallback items
            filtered = fallbackPhotos_js_1.FALLBACK_PHOTOS;
        }
        return this.paginateFallback(filtered, page, perPage);
    }
}
exports.UnsplashService = UnsplashService;
exports.unsplashService = new UnsplashService();
