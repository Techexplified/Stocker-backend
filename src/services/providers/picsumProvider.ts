import { PicsumPhoto, ProviderStatusInfo, StockImage } from "../../types.js";
import { calculateAspectRatio, calculateColorMatch } from "../../utils/colorAndRatio.js";
import { ProviderHealthTracker } from "../../utils/healthTracker.js";

const PICSUM_BASE_URL = "https://picsum.photos";

export class PicsumProvider {
  readonly health = new ProviderHealthTracker("Lorem Picsum");
  readonly isConfigured = true;

  getStatus(): ProviderStatusInfo {
    return this.health.getStatus(true, true);
  }

  private mapPhoto(photo: PicsumPhoto, customRatio?: string, targetColor?: string): StockImage {
    let width = photo.width > 2400 ? Math.round(photo.width / 2) : photo.width;
    let height = photo.height > 2400 ? Math.round(photo.height / 2) : photo.height;

    if (customRatio === "1:1") {
      width = 1080;
      height = 1080;
    } else if (customRatio === "16:9") {
      width = 1920;
      height = 1080;
    } else if (customRatio === "4:5") {
      width = 1080;
      height = 1350;
    } else if (customRatio === "9:16") {
      width = 1080;
      height = 1920;
    }

    const calculatedRatio = customRatio || calculateAspectRatio(photo.width, photo.height);
    const imageUrl = `${PICSUM_BASE_URL}/id/${photo.id}/${width}/${height}`;

    const palette = ["#3E7CB1", "#1E3A8A", "#0D9488", "#16A34A", "#CA8A04", "#EA580C", "#DC2626", "#9333EA", "#4B5563"];
    const colorIndex = Math.abs(parseInt(photo.id, 10) || 0) % palette.length;
    const dominantColor = targetColor || palette[colorIndex];

    return {
      id: `picsum-${photo.id}`,
      url: imageUrl,
      title: `Photo by ${photo.author || "Artist"}`,
      category: "photography",
      aspectRatio: calculatedRatio,
      dimensions: `${width} × ${height}`,
      dominantColor,
      matchScore: targetColor ? calculateColorMatch(dominantColor, targetColor) : undefined,
      provider: "picsum",
      author: {
        name: photo.author,
        username: photo.author.toLowerCase().replace(/\s+/g, "_"),
        link: photo.url || `https://picsum.photos/id/${photo.id}/info`,
      },
    };
  }

  async getCurated(page = 1, perPage = 20, customRatio?: string): Promise<StockImage[]> {
    if (this.health.isCircuitOpen) return [];
    try {
      const res = await fetch(`${PICSUM_BASE_URL}/v2/list?page=${page}&limit=${perPage}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.health.recordFailure(`Picsum returned HTTP ${res.status}`);
        return [];
      }
      const list = (await res.json()) as PicsumPhoto[];
      this.health.recordSuccess();
      return list.map((p) => this.mapPhoto(p, customRatio));
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
    const { page = 1, perPage = 20, orientation, color } = options;

    let targetRatio: string | undefined;
    if (orientation === "squarish") targetRatio = "1:1";
    else if (orientation === "portrait") targetRatio = "4:5";
    else if (orientation === "landscape") targetRatio = "16:9";

    const photos = await this.getCurated(page, perPage, targetRatio);

    if (query && query.trim() !== "") {
      const q = query.toLowerCase();
      const matched = photos.filter((p) => p.author?.name.toLowerCase().includes(q));
      if (matched.length > 0) return matched;
    }

    return photos.map((p) => ({
      ...p,
      dominantColor: color || p.dominantColor,
      matchScore: color ? calculateColorMatch(p.dominantColor, color) : undefined,
    }));
  }
}

export const picsumProvider = new PicsumProvider();
