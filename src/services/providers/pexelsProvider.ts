import { PexelsPhoto, PexelsSearchResponse, ProviderStatusInfo, StockImage } from "../../types.js";
import { calculateAspectRatio, calculateColorMatch } from "../../utils/colorAndRatio.js";
import { ProviderHealthTracker } from "../../utils/healthTracker.js";

const PEXELS_BASE_URL = "https://api.pexels.com/v1";

export class PexelsProvider {
  readonly health = new ProviderHealthTracker("Pexels");

  get isConfigured(): boolean {
    const key = process.env.PEXELS_API_KEY?.trim();
    return !!key && key.length > 10;
  }

  getStatus(): ProviderStatusInfo {
    return this.health.getStatus(this.isConfigured);
  }

  private get headers(): Record<string, string> {
    return {
      Authorization: process.env.PEXELS_API_KEY?.trim() || "",
    };
  }

  private mapPhoto(photo: PexelsPhoto, targetColor?: string): StockImage {
    const dominantColor = photo.avg_color?.startsWith("#") ? photo.avg_color : `#${photo.avg_color || "3E7CB1"}`;

    return {
      id: `pexels-${photo.id}`,
      url: photo.src.large2x || photo.src.large || photo.src.original,
      title: photo.alt || "Pexels Stock Photo",
      category: "photography",
      aspectRatio: calculateAspectRatio(photo.width, photo.height),
      dimensions: `${photo.width} × ${photo.height}`,
      dominantColor,
      matchScore: targetColor ? calculateColorMatch(dominantColor, targetColor) : undefined,
      provider: "pexels",
      author: {
        name: photo.photographer,
        username: photo.photographer.toLowerCase().replace(/\s+/g, ""),
        link: photo.photographer_url || photo.url,
      },
    };
  }

  async getCurated(page = 1, perPage = 20): Promise<StockImage[]> {
    if (!this.isConfigured || this.health.isCircuitOpen) return [];
    try {
      const res = await fetch(
        `${PEXELS_BASE_URL}/curated?page=${page}&per_page=${perPage}`,
        { headers: this.headers, signal: AbortSignal.timeout(5000) }
      );
      if (!res.ok) {
        const errorMsg =
          res.status === 401
            ? "Invalid Pexels API key"
            : res.status === 403
            ? "Pexels access forbidden or key disabled"
            : res.status === 429
            ? "Pexels rate limit exceeded"
            : `Pexels returned HTTP ${res.status}`;
        this.health.recordFailure(errorMsg);
        return [];
      }
      const data = (await res.json()) as PexelsSearchResponse;
      this.health.recordSuccess();
      return (data.photos || []).map((p) => this.mapPhoto(p));
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      const errorMsg = isTimeout ? "Request timed out after 5s" : err.message || "Network error";
      this.health.recordFailure(errorMsg);
      return [];
    }
  }

  async search(
    query: string,
    options: {
      page?: number;
      perPage?: number;
      orientation?: "landscape" | "portrait" | "squarish";
      color?: string;
    } = {}
  ): Promise<StockImage[]> {
    if (!this.isConfigured || this.health.isCircuitOpen) return [];
    try {
      const { page = 1, perPage = 20, orientation, color } = options;
      const url = new URL(`${PEXELS_BASE_URL}/search`);
      url.searchParams.append("query", query || "aesthetic");
      url.searchParams.append("page", String(page));
      url.searchParams.append("per_page", String(perPage));

      if (orientation) {
        url.searchParams.append(
          "orientation",
          orientation === "squarish" ? "square" : orientation
        );
      }
      if (color) {
        url.searchParams.append("color", color.replace("#", ""));
      }

      const res = await fetch(url.toString(), {
        headers: this.headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const errorMsg =
          res.status === 401
            ? "Invalid Pexels API key"
            : res.status === 403
            ? "Pexels access forbidden or key disabled"
            : res.status === 429
            ? "Pexels rate limit exceeded"
            : `Pexels returned HTTP ${res.status}`;
        this.health.recordFailure(errorMsg);
        return [];
      }
      const data = (await res.json()) as PexelsSearchResponse;
      this.health.recordSuccess();
      return (data.photos || []).map((p) => this.mapPhoto(p, color));
    } catch (err: any) {
      const isTimeout = err.name === "TimeoutError" || err.name === "AbortError";
      const errorMsg = isTimeout ? "Request timed out after 5s" : err.message || "Network error";
      this.health.recordFailure(errorMsg);
      return [];
    }
  }
}

export const pexelsProvider = new PexelsProvider();
