export type PhotoProvider = "unsplash" | "pexels" | "pixabay" | "picsum";

export interface StockImage {
  id: string;
  url: string;
  title: string;
  category: string;
  aspectRatio: string;
  dimensions: string;
  dominantColor: string;
  matchScore?: number;
  provider?: PhotoProvider;
  isFallback?: boolean;
  fallbackReason?: string;
  author?: {
    name: string;
    username: string;
    link: string;
  };
  downloadLocation?: string;
}

export interface ProviderStatusInfo {
  configured: boolean;
  available: boolean;
  name: string;
  isKeyless?: boolean;
  lastError?: string;
  message?: string;
}

export interface QueryResult {
  photos: StockImage[];
  fallback: boolean;
  warning?: string;
  provider: PhotoProvider | "all";
}

// --- Unsplash Interfaces ---
export interface UnsplashPhotoUrls {
  raw: string;
  full: string;
  regular: string;
  small: string;
  thumb: string;
}

export interface UnsplashUser {
  id: string;
  name: string;
  username: string;
  links: {
    html: string;
  };
}

export interface UnsplashPhoto {
  id: string;
  created_at: string;
  width: number;
  height: number;
  color: string;
  description: string | null;
  alt_description: string | null;
  urls: UnsplashPhotoUrls;
  links: {
    download_location: string;
  };
  user: UnsplashUser;
  tags?: Array<{ title: string }>;
}

export interface UnsplashSearchResponse {
  total: number;
  total_pages: number;
  results: UnsplashPhoto[];
}

// --- Pexels Interfaces ---
export interface PexelsPhotoSrc {
  original: string;
  large2x: string;
  large: string;
  medium: string;
  small: string;
  portrait: string;
  landscape: string;
  tiny: string;
}

export interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  photographer_id: number;
  avg_color: string;
  src: PexelsPhotoSrc;
  alt: string;
}

export interface PexelsSearchResponse {
  page: number;
  per_page: number;
  total_results: number;
  photos: PexelsPhoto[];
}

// --- Pixabay Interfaces ---
export interface PixabayHit {
  id: number;
  pageURL: string;
  type: string;
  tags: string;
  previewURL: string;
  previewWidth: number;
  previewHeight: number;
  webformatURL: string;
  webformatWidth: number;
  webformatHeight: number;
  largeImageURL: string;
  fullHDURL?: string;
  imageWidth: number;
  imageHeight: number;
  views: number;
  downloads: number;
  likes: number;
  user_id: number;
  user: string;
  userImageURL: string;
}

export interface PixabaySearchResponse {
  total: number;
  totalHits: number;
  hits: PixabayHit[];
}

// --- Lorem Picsum Interfaces ---
export interface PicsumPhoto {
  id: string;
  author: string;
  width: number;
  height: number;
  url: string;
  download_url: string;
}

// --- Query Options ---
export interface SmartQueryOptions {
  query?: string;
  provider?: PhotoProvider | "all";
  page?: number;
  perPage?: number;
  orientation?: "landscape" | "portrait" | "squarish";
  ratio?: string;
  color?: string;
}
