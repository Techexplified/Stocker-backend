"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.photoAggregator = exports.PhotoAggregator = void 0;
const fallbackPhotos_js_1 = require("../data/fallbackPhotos.js");
const pexelsProvider_js_1 = require("./providers/pexelsProvider.js");
const picsumProvider_js_1 = require("./providers/picsumProvider.js");
const pixabayProvider_js_1 = require("./providers/pixabayProvider.js");
const unsplashProvider_js_1 = require("./providers/unsplashProvider.js");
class PhotoAggregator {
    // Check which providers currently have API keys configured and are healthy
    getProviderStatus() {
        return {
            unsplash: unsplashProvider_js_1.unsplashProvider.getStatus(),
            pexels: pexelsProvider_js_1.pexelsProvider.getStatus(),
            pixabay: pixabayProvider_js_1.pixabayProvider.getStatus(),
            picsum: picsumProvider_js_1.picsumProvider.getStatus(),
        };
    }
    // 1. Smart Curated Feed
    async getCurated(options = {}) {
        const { provider = "all", page = 1, perPage = 24 } = options;
        if (provider !== "all") {
            return this.fetchFromSingleProvider(provider, "curated", "", options);
        }
        // Determine active & healthy providers
        const activeProviders = [];
        if (unsplashProvider_js_1.unsplashProvider.isConfigured && !unsplashProvider_js_1.unsplashProvider.health.isCircuitOpen) {
            activeProviders.push(() => unsplashProvider_js_1.unsplashProvider.getCurated(page, Math.ceil(perPage / 2)));
        }
        if (pexelsProvider_js_1.pexelsProvider.isConfigured && !pexelsProvider_js_1.pexelsProvider.health.isCircuitOpen) {
            activeProviders.push(() => pexelsProvider_js_1.pexelsProvider.getCurated(page, Math.ceil(perPage / 2)));
        }
        if (pixabayProvider_js_1.pixabayProvider.isConfigured && !pixabayProvider_js_1.pixabayProvider.health.isCircuitOpen) {
            activeProviders.push(() => pixabayProvider_js_1.pixabayProvider.getCurated(page, Math.ceil(perPage / 2)));
        }
        // Lorem Picsum is always available and adds fresh keyless photography
        if (!picsumProvider_js_1.picsumProvider.health.isCircuitOpen) {
            activeProviders.push(() => picsumProvider_js_1.picsumProvider.getCurated(page, Math.ceil(perPage / 2)));
        }
        const results = await this.executeConcurrent(activeProviders);
        const interleaved = this.interleaveResults(results, perPage);
        // If active providers returned fewer items than requested quota, replenish with curated fallback catalog
        let fallback = false;
        let warning;
        if (interleaved.length < perPage) {
            fallback = true;
            for (const item of fallbackPhotos_js_1.FALLBACK_PHOTOS) {
                if (interleaved.length >= perPage)
                    break;
                if (!interleaved.some((p) => p.id === item.id)) {
                    interleaved.push({ ...item, provider: "unsplash", isFallback: true });
                }
            }
        }
        if (interleaved.length > 0) {
            return {
                photos: interleaved,
                fallback,
                warning: fallback ? "Some providers are offline or missing keys; replenished with curated catalog." : undefined,
                provider: "all",
            };
        }
        // Full offline fallback
        const start = (page - 1) * perPage;
        return {
            photos: fallbackPhotos_js_1.FALLBACK_PHOTOS.slice(start, start + perPage).map((p) => ({ ...p, isFallback: true })),
            fallback: true,
            warning: "All photo APIs are currently offline or unresponsive. Displaying offline curated catalog.",
            provider: "all",
        };
    }
    // 2. Smart Search Across Providers
    async search(query, options = {}) {
        const { provider = "all", page = 1, perPage = 24, orientation, color } = options;
        if (provider !== "all") {
            return this.fetchFromSingleProvider(provider, "search", query, options);
        }
        const activeProviders = [];
        if (unsplashProvider_js_1.unsplashProvider.isConfigured && !unsplashProvider_js_1.unsplashProvider.health.isCircuitOpen) {
            activeProviders.push(() => unsplashProvider_js_1.unsplashProvider.search(query, { page, perPage: Math.ceil(perPage / 2), orientation, color }));
        }
        if (pexelsProvider_js_1.pexelsProvider.isConfigured && !pexelsProvider_js_1.pexelsProvider.health.isCircuitOpen) {
            activeProviders.push(() => pexelsProvider_js_1.pexelsProvider.search(query, { page, perPage: Math.ceil(perPage / 2), orientation, color }));
        }
        if (pixabayProvider_js_1.pixabayProvider.isConfigured && !pixabayProvider_js_1.pixabayProvider.health.isCircuitOpen) {
            activeProviders.push(() => pixabayProvider_js_1.pixabayProvider.search(query, { page, perPage: Math.ceil(perPage / 2), orientation, color }));
        }
        // Complementary keyless source
        if (!picsumProvider_js_1.picsumProvider.health.isCircuitOpen) {
            activeProviders.push(() => picsumProvider_js_1.picsumProvider.search(query, { page, perPage: Math.ceil(perPage / 3), orientation, color }));
        }
        const results = await this.executeConcurrent(activeProviders);
        const interleaved = this.interleaveResults(results, perPage);
        let fallback = false;
        let warning;
        // If results are below quota, supplement with matching catalog photos
        if (interleaved.length < perPage) {
            const q = query.toLowerCase().trim();
            const fallbackMatches = fallbackPhotos_js_1.FALLBACK_PHOTOS.filter((img) => !interleaved.some((p) => p.id === img.id) &&
                (!q ||
                    q === "photo" ||
                    q === "aesthetic" ||
                    q === "square" ||
                    img.title.toLowerCase().includes(q) ||
                    img.category.toLowerCase().includes(q)));
            if (fallbackMatches.length > 0) {
                fallback = true;
                for (const item of fallbackMatches) {
                    if (interleaved.length >= perPage)
                        break;
                    interleaved.push({ ...item, provider: "unsplash", isFallback: true });
                }
            }
        }
        if (interleaved.length > 0) {
            return {
                photos: interleaved,
                fallback,
                warning,
                provider: "all",
            };
        }
        // Offline / zero-match fallback
        const q = query.toLowerCase().trim();
        const fallbackMatches = fallbackPhotos_js_1.FALLBACK_PHOTOS.filter((img) => img.title.toLowerCase().includes(q) || img.category.toLowerCase().includes(q));
        const photosToReturn = (fallbackMatches.length > 0 ? fallbackMatches : fallbackPhotos_js_1.FALLBACK_PHOTOS).slice(0, perPage);
        return {
            photos: photosToReturn.map((p) => ({ ...p, isFallback: true })),
            fallback: true,
            warning: `No live results found for "${query}". Showing curated library photos.`,
            provider: "all",
        };
    }
    // 3. Smart Ratio Filtering
    async getByRatio(ratio, options = {}) {
        let orientation;
        if (ratio === "1:1")
            orientation = "squarish";
        else if (ratio === "4:5" || ratio === "9:16" || ratio === "3:4" || ratio === "2:3")
            orientation = "portrait";
        else if (ratio === "16:9" || ratio === "1.91:1" || ratio === "3:2" || ratio === "4:3")
            orientation = "landscape";
        const result = await this.search(ratio === "1:1" ? "square" : "photo", {
            ...options,
            orientation,
        });
        return {
            ...result,
            photos: result.photos.map((p) => ({
                ...p,
                aspectRatio: ratio,
            })),
        };
    }
    // 4. Smart Brand Color Filtering
    async getByColor(hexColor, options = {}) {
        const result = await this.search("", {
            ...options,
            color: hexColor,
        });
        return {
            ...result,
            photos: result.photos.sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)),
        };
    }
    // 5. Track Unsplash Download
    async trackDownload(downloadLocation) {
        if (downloadLocation) {
            await unsplashProvider_js_1.unsplashProvider.trackDownload(downloadLocation);
        }
    }
    // Helper: Query a specific provider with graceful fallback
    async fetchFromSingleProvider(provider, mode, query, options) {
        const { page = 1, perPage = 24, orientation, color } = options;
        let photos = [];
        let isConfigured = true;
        let providerName = "Provider";
        let failureReason;
        if (provider === "unsplash") {
            providerName = "Unsplash";
            isConfigured = unsplashProvider_js_1.unsplashProvider.isConfigured;
            failureReason = unsplashProvider_js_1.unsplashProvider.health.currentError;
            if (isConfigured && !unsplashProvider_js_1.unsplashProvider.health.isCircuitOpen) {
                photos =
                    mode === "curated"
                        ? await unsplashProvider_js_1.unsplashProvider.getCurated(page, perPage)
                        : await unsplashProvider_js_1.unsplashProvider.search(query, { page, perPage, orientation, color });
            }
        }
        else if (provider === "pexels") {
            providerName = "Pexels";
            isConfigured = pexelsProvider_js_1.pexelsProvider.isConfigured;
            failureReason = pexelsProvider_js_1.pexelsProvider.health.currentError;
            if (isConfigured && !pexelsProvider_js_1.pexelsProvider.health.isCircuitOpen) {
                photos =
                    mode === "curated"
                        ? await pexelsProvider_js_1.pexelsProvider.getCurated(page, perPage)
                        : await pexelsProvider_js_1.pexelsProvider.search(query, { page, perPage, orientation, color });
            }
        }
        else if (provider === "pixabay") {
            providerName = "Pixabay";
            isConfigured = pixabayProvider_js_1.pixabayProvider.isConfigured;
            failureReason = pixabayProvider_js_1.pixabayProvider.health.currentError;
            if (isConfigured && !pixabayProvider_js_1.pixabayProvider.health.isCircuitOpen) {
                photos =
                    mode === "curated"
                        ? await pixabayProvider_js_1.pixabayProvider.getCurated(page, perPage)
                        : await pixabayProvider_js_1.pixabayProvider.search(query, { page, perPage, orientation, color });
            }
        }
        else if (provider === "picsum") {
            providerName = "Lorem Picsum";
            isConfigured = true;
            failureReason = picsumProvider_js_1.picsumProvider.health.currentError;
            if (!picsumProvider_js_1.picsumProvider.health.isCircuitOpen) {
                photos =
                    mode === "curated"
                        ? await picsumProvider_js_1.picsumProvider.getCurated(page, perPage)
                        : await picsumProvider_js_1.picsumProvider.search(query, { page, perPage, orientation, color });
            }
        }
        // If the provider returned photos successfully:
        if (photos.length > 0) {
            return {
                photos,
                fallback: false,
                provider,
            };
        }
        // --- GRACEFUL FALLBACK HANDLING ---
        // If not configured (missing keys) or API failed/unresponsive:
        let warningMsg = "";
        if (!isConfigured) {
            warningMsg = `${providerName} API key is not configured in .env. Showing curated photography.`;
        }
        else if (failureReason) {
            warningMsg = `${providerName} is currently unavailable (${failureReason}). Showing curated photography.`;
        }
        else {
            warningMsg = `No direct photos returned from ${providerName}. Showing curated fallback photos.`;
        }
        // Build fallback list:
        // 1. First, search in FALLBACK_PHOTOS for matching items
        const q = query.toLowerCase().trim();
        let fallbackItems = fallbackPhotos_js_1.FALLBACK_PHOTOS.filter((img) => {
            if (!q)
                return true;
            return img.title.toLowerCase().includes(q) || img.category.toLowerCase().includes(q);
        });
        if (fallbackItems.length === 0) {
            fallbackItems = fallbackPhotos_js_1.FALLBACK_PHOTOS;
        }
        const start = (page - 1) * perPage;
        const pageItems = fallbackItems.slice(start, start + perPage);
        const mappedFallback = pageItems.map((p) => ({
            ...p,
            provider,
            isFallback: true,
            fallbackReason: warningMsg,
        }));
        return {
            photos: mappedFallback,
            fallback: true,
            warning: warningMsg,
            provider,
        };
    }
    // Helper: Execute calls concurrently with safe settling
    async executeConcurrent(tasks) {
        const results = await Promise.allSettled(tasks.map((task) => task()));
        return results
            .filter((r) => r.status === "fulfilled" && Array.isArray(r.value))
            .map((r) => r.value);
    }
    // Helper: Round-robin interleave results from multiple providers
    interleaveResults(groups, limit) {
        const interleaved = [];
        const seenIds = new Set();
        let hasMore = true;
        let index = 0;
        while (hasMore && interleaved.length < limit) {
            hasMore = false;
            for (const group of groups) {
                if (index < group.length) {
                    hasMore = true;
                    const photo = group[index];
                    if (!seenIds.has(photo.id)) {
                        seenIds.add(photo.id);
                        interleaved.push(photo);
                        if (interleaved.length >= limit)
                            break;
                    }
                }
            }
            index++;
        }
        return interleaved;
    }
}
exports.PhotoAggregator = PhotoAggregator;
exports.photoAggregator = new PhotoAggregator();
