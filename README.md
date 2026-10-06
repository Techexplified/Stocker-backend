# Stocker Backend API

Fast, lightweight Node.js & TypeScript proxy server for the Stocker Figma Plugin.

## Features
- **API Key Protection**: Shields your Unsplash API keys from the client plugin bundle.
- **Curated & Live Search**: Connects to the Unsplash API or provides seamless curated fallback photos when offline or without an API key.
- **Aspect Ratio & Brand Color Matcher**: Translates ratios (`1:1`, `4:5`, `16:9`, `9:16`, `1.91:1`) and calculates color similarity scores against brand palette HEX codes.
- **CORS Image Proxy**: Provides a `/api/photos/proxy-image` endpoint to prevent canvas tainting in Figma plugin environments.
- **Download Metrics**: Automatically tracks image downloads according to Unsplash API guidelines.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment (Optional)
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```
To enable live Unsplash searches, add your Unsplash Access Key:
```env
PORT=3001
UNSPLASH_ACCESS_KEY=your_unsplash_access_key_here
```
*(If left blank, the backend operates in high-quality Curated Fallback Mode automatically).*

### 3. Run Development Server
```bash
npm run dev
```
The server will start at `http://localhost:3001`.

## Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | `GET` | Health check & Unsplash connection status |
| `/api/photos` | `GET` | Curated editorial photos (`?page=1&per_page=24`) |
| `/api/photos/search` | `GET` | Search photos (`?q=dog&orientation=landscape`) |
| `/api/photos/ratio` | `GET` | Filter photos by ratio (`?ratio=1:1`) |
| `/api/photos/color` | `GET` | Filter photos by color (`?color=#3E7CB1`) |
| `/api/photos/proxy-image` | `GET` | Proxy image binary with open CORS headers (`?url=...`) |
| `/api/photos/track-download` | `POST` | Track download attribution |
| `/api/cache/stats` | `GET` | Cache hit ratio, entry/photo counts, DB size, top queries |
| `/api/cache` | `DELETE` | Clear cache (optional `?endpoint=search&provider=unsplash&q=dog`) |
| `/api/cache/purge` | `POST` | Run expiry purge + LRU eviction now |

## Query Cache (TypeORM: SQLite, MySQL, PostgreSQL)

Every photo query (`/api/photos`, `/search`, `/ratio`, `/color`) is **looked up in the database first**; provider APIs are only called on a miss or after the entry expires.

Built on **TypeORM**, you can host the cache on **SQLite** (zero-config local default), **MySQL**, or **PostgreSQL** simply by configuring your environment variables.

```
request ─► normalize params ─► SELECT query_cache ──fresh──► HIT (≈1–3 ms, no API call)
                                      │
                                 miss/expired
                                      ▼
                         call providers (coalesced) ──ok──► INSERT/UPSERT ─► MISS
                                      │
                               error / offline catalog
                                      ▼
                       expired row ≤ CACHE_STALE_MAX_AGE? ──yes──► STALE
                                      │ no
                                      ▼
                              propagate error / fallback
```

### Supported Databases

- **SQLite** (Default): Zero setup, embedded, uses WAL mode (`better-sqlite3`). Set `CACHE_DB_TYPE=sqlite`.
- **PostgreSQL**: Set `CACHE_DB_TYPE=postgres` and `CACHE_DB_URL=postgres://user:pass@host:5432/dbname`.
- **MySQL / MariaDB**: Set `CACHE_DB_TYPE=mysql` and `CACHE_DB_URL=mysql://user:pass@host:3306/dbname`.

### Schema & Migrations

Automatic versioned migrations run on startup (`src/cache/migrations/`):
- `photos`: One row per unique provider photo (canonical metadata).
- `query_cache`: One row per normalized query (endpoint, provider, q, page, per_page, orientation, color, ratio), with `expires_at`, `hit_count`, and `last_accessed_at`.
- `query_cache_photos`: Ordered join table with query-specific attributes (`match_score`, ratio override, fallback flags), with `ON DELETE CASCADE`.

### Features
- Responses include `cache: { status, cachedAt, expiresAt, ageSeconds }` and an `X-Cache: HIT|MISS|STALE|BYPASS|DISABLED` header.
- Force a fresh fetch with `?refresh=true` or a `Cache-Control: no-cache` request header.
- Concurrent identical misses share one upstream request (request coalescing).
- Degraded/fallback results use a short TTL (`CACHE_TTL_FALLBACK`), so live providers are retried soon.
- Database errors fail open: the request goes straight to the providers without breaking user experience.
- Background maintenance purges rows past `CACHE_STALE_MAX_AGE` and LRU-evicts queries above `CACHE_MAX_ENTRIES`.

See `.env.example` for all `CACHE_*` settings.

---

## Deploying to Vercel

The backend is built to run flawlessly on **Vercel Serverless Functions**.

### 1. Vercel Project Setup
1. Push your repository to GitHub / GitLab.
2. In the [Vercel Dashboard](https://vercel.com/new), import your repository.
3. In **Project Settings**, set the **Root Directory** to `backend`.
4. Add any provider environment variables under **Environment Variables**:
   - `UNSPLASH_ACCESS_KEY`
   - `PEXELS_API_KEY`
   - `PIXABAY_API_KEY`

### 2. Zero-Database Serverless Fallback
- **No Database Environment? No Problem!** If `CACHE_DB_*` variables are omitted, the backend automatically operates in **direct live API mode** (`cache.status: "SKIPPED"`).
- It will **not** attempt to load native SQLite or write to Vercel's read-only file system, guaranteeing zero cold-start crashes or deployment failures.

### 3. Enabling Remote Cache on Vercel (Optional)
If you want persistent relational caching in production to protect your API quotas:
1. Provision a free PostgreSQL database on [Supabase](https://supabase.com) or [Neon](https://neon.tech), or MySQL on PlanetScale / Railway.
2. Add the connection string to your Vercel Environment Variables:
   ```env
   CACHE_DB_URL=postgres://user:password@ep-sample.us-east-2.aws.neon.tech/neondb?sslmode=require
   ```
3. TypeORM will automatically connect, run schema migrations on startup, and store query caches for 7 days.

