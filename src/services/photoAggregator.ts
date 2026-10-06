import { FALLBACK_PHOTOS } from "../data/fallbackPhotos.js";
import { PhotoProvider, ProviderStatusInfo, QueryResult, SmartQueryOptions, StockImage } from "../types.js";
import { pexelsProvider } from "./providers/pexelsProvider.js";
import { picsumProvider } from "./providers/picsumProvider.js";
import { pixabayProvider } from "./providers/pixabayProvider.js";
import { unsplashProvider } from "./providers/unsplashProvider.js";

export class PhotoAggregator {
  // Check which providers currently have API keys configured and are healthy
  getProviderStatus(): Record<PhotoProvider, ProviderStatusInfo> {
    return {
      unsplash: unsplashProvider.getStatus(),
      pexels: pexelsProvider.getStatus(),
      pixabay: pixabayProvider.getStatus(),
      picsum: picsumProvider.getStatus(),
    };
  }

  // 1. Smart Curated Feed
  async getCurated(options: SmartQueryOptions = {}): Promise<QueryResult> {
    const { provider = "all", page = 1, perPage = 24 } = options;

    if (provider !== "all") {
      return this.fetchFromSingleProvider(provider, "curated", "", options);
    }

    // Determine active & healthy providers
    const activeProviders: Array<() => Promise<StockImage[]>> = [];

    if (unsplashProvider.isConfigured && !unsplashProvider.health.isCircuitOpen) {
      activeProviders.push(() => unsplashProvider.getCurated(page, Math.ceil(perPage / 2)));
    }
    if (pexelsProvider.isConfigured && !pexelsProvider.health.isCircuitOpen) {
      activeProviders.push(() => pexelsProvider.getCurated(page, Math.ceil(perPage / 2)));
    }
    if (pixabayProvider.isConfigured && !pixabayProvider.health.isCircuitOpen) {
      activeProviders.push(() => pixabayProvider.getCurated(page, Math.ceil(perPage / 2)));
    }

    // Lorem Picsum is always available and adds fresh keyless photography
    if (!picsumProvider.health.isCircuitOpen) {
      activeProviders.push(() => picsumProvider.getCurated(page, Math.ceil(perPage / 2)));
    }

    const results = await this.executeConcurrent(activeProviders);
    const interleaved = this.interleaveResults(results, perPage);

    // If active providers returned fewer items than requested quota, replenish with curated fallback catalog
    let fallback = false;
    let warning: string | undefined;

    if (interleaved.length < perPage) {
      fallback = true;
      for (const item of FALLBACK_PHOTOS) {
        if (interleaved.length >= perPage) break;
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
      photos: FALLBACK_PHOTOS.slice(start, start + perPage).map((p) => ({ ...p, isFallback: true })),
      fallback: true,
      warning: "All photo APIs are currently offline or unresponsive. Displaying offline curated catalog.",
      provider: "all",
    };
  }

  // 2. Smart Search Across Providers
  async search(query: string, options: SmartQueryOptions = {}): Promise<QueryResult> {
    const { provider = "all", page = 1, perPage = 24, orientation, color } = options;

    if (provider !== "all") {
      return this.fetchFromSingleProvider(provider, "search", query, options);
    }

    const activeProviders: Array<() => Promise<StockImage[]>> = [];

    if (unsplashProvider.isConfigured && !unsplashProvider.health.isCircuitOpen) {
      activeProviders.push(() =>
        unsplashProvider.search(query, { page, perPage: Math.ceil(perPage / 2), orientation, color })
      );
    }
    if (pexelsProvider.isConfigured && !pexelsProvider.health.isCircuitOpen) {
      activeProviders.push(() =>
        pexelsProvider.search(query, { page, perPage: Math.ceil(perPage / 2), orientation, color })
      );
    }
    if (pixabayProvider.isConfigured && !pixabayProvider.health.isCircuitOpen) {
      activeProviders.push(() =>
        pixabayProvider.search(query, { page, perPage: Math.ceil(perPage / 2), orientation, color })
      );
    }

    // Complementary keyless source
    if (!picsumProvider.health.isCircuitOpen) {
      activeProviders.push(() =>
        picsumProvider.search(query, { page, perPage: Math.ceil(perPage / 3), orientation, color })
      );
    }

    const results = await this.executeConcurrent(activeProviders);
    const interleaved = this.interleaveResults(results, perPage);

    let fallback = false;
    let warning: string | undefined;

    // If results are below quota, supplement with matching catalog photos
    if (interleaved.length < perPage) {
      const q = query.toLowerCase().trim();
      const fallbackMatches = FALLBACK_PHOTOS.filter(
        (img) =>
          !interleaved.some((p) => p.id === img.id) &&
          (!q ||
            q === "photo" ||
            q === "aesthetic" ||
            q === "square" ||
            img.title.toLowerCase().includes(q) ||
            img.category.toLowerCase().includes(q))
      );
      if (fallbackMatches.length > 0) {
        fallback = true;
        for (const item of fallbackMatches) {
          if (interleaved.length >= perPage) break;
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
    const fallbackMatches = FALLBACK_PHOTOS.filter(
      (img) => img.title.toLowerCase().includes(q) || img.category.toLowerCase().includes(q)
    );
    const photosToReturn = (fallbackMatches.length > 0 ? fallbackMatches : FALLBACK_PHOTOS).slice(0, perPage);

    return {
      photos: photosToReturn.map((p) => ({ ...p, isFallback: true })),
      fallback: true,
      warning: `No live results found for "${query}". Showing curated library photos.`,
      provider: "all",
    };
  }

  // 3. Smart Ratio Filtering
  async getByRatio(ratio: string, options: SmartQueryOptions = {}): Promise<QueryResult> {
    let orientation: "landscape" | "portrait" | "squarish" | undefined;
    if (ratio === "1:1") orientation = "squarish";
    else if (ratio === "4:5" || ratio === "9:16" || ratio === "3:4" || ratio === "2:3") orientation = "portrait";
    else if (ratio === "16:9" || ratio === "1.91:1" || ratio === "3:2" || ratio === "4:3") orientation = "landscape";

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
  async getByColor(hexColor: string, options: SmartQueryOptions = {}): Promise<QueryResult> {
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
  async trackDownload(downloadLocation?: string): Promise<void> {
    if (downloadLocation) {
      await unsplashProvider.trackDownload(downloadLocation);
    }
  }

  // Helper: Query a specific provider with graceful fallback
  private async fetchFromSingleProvider(
    provider: PhotoProvider,
    mode: "curated" | "search",
    query: string,
    options: SmartQueryOptions
  ): Promise<QueryResult> {
    const { page = 1, perPage = 24, orientation, color } = options;

    let photos: StockImage[] = [];
    let isConfigured = true;
    let providerName = "Provider";
    let failureReason: string | undefined;

    if (provider === "unsplash") {
      providerName = "Unsplash";
      isConfigured = unsplashProvider.isConfigured;
      failureReason = unsplashProvider.health.currentError;
      if (isConfigured && !unsplashProvider.health.isCircuitOpen) {
        photos =
          mode === "curated"
            ? await unsplashProvider.getCurated(page, perPage)
            : await unsplashProvider.search(query, { page, perPage, orientation, color });
      }
    } else if (provider === "pexels") {
      providerName = "Pexels";
      isConfigured = pexelsProvider.isConfigured;
      failureReason = pexelsProvider.health.currentError;
      if (isConfigured && !pexelsProvider.health.isCircuitOpen) {
        photos =
          mode === "curated"
            ? await pexelsProvider.getCurated(page, perPage)
            : await pexelsProvider.search(query, { page, perPage, orientation, color });
      }
    } else if (provider === "pixabay") {
      providerName = "Pixabay";
      isConfigured = pixabayProvider.isConfigured;
      failureReason = pixabayProvider.health.currentError;
      if (isConfigured && !pixabayProvider.health.isCircuitOpen) {
        photos =
          mode === "curated"
            ? await pixabayProvider.getCurated(page, perPage)
            : await pixabayProvider.search(query, { page, perPage, orientation, color });
      }
    } else if (provider === "picsum") {
      providerName = "Lorem Picsum";
      isConfigured = true;
      failureReason = picsumProvider.health.currentError;
      if (!picsumProvider.health.isCircuitOpen) {
        photos =
          mode === "curated"
            ? await picsumProvider.getCurated(page, perPage)
            : await picsumProvider.search(query, { page, perPage, orientation, color });
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
    } else if (failureReason) {
      warningMsg = `${providerName} is currently unavailable (${failureReason}). Showing curated photography.`;
    } else {
      warningMsg = `No direct photos returned from ${providerName}. Showing curated fallback photos.`;
    }

    // Build fallback list:
    // 1. First, search in FALLBACK_PHOTOS for matching items
    const q = query.toLowerCase().trim();
    let fallbackItems = FALLBACK_PHOTOS.filter((img) => {
      if (!q) return true;
      return img.title.toLowerCase().includes(q) || img.category.toLowerCase().includes(q);
    });

    if (fallbackItems.length === 0) {
      fallbackItems = FALLBACK_PHOTOS;
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
  private async executeConcurrent(
    tasks: Array<() => Promise<StockImage[]>>
  ): Promise<StockImage[][]> {
    const results = await Promise.allSettled(tasks.map((task) => task()));
    return results
      .filter(
        (r): r is PromiseFulfilledResult<StockImage[]> =>
          r.status === "fulfilled" && Array.isArray(r.value)
      )
      .map((r) => r.value);
  }

  // Helper: Round-robin interleave results from multiple providers
  private interleaveResults(groups: StockImage[][], limit: number): StockImage[] {
    const interleaved: StockImage[] = [];
    const seenIds = new Set<string>();

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
            if (interleaved.length >= limit) break;
          }
        }
      }
      index++;
    }

    return interleaved;
  }
}

export const photoAggregator = new PhotoAggregator();
