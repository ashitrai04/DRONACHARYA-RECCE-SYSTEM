# Dronacharya Recce System — Setup & Revival Guide

AI-powered artillery terrain-intelligence platform. Picks gun-deployment areas,
plans terrain-aware routes, and drafts drone recce missions across six Indian
districts (Ganganagar, Jaisalmer, Nashik, Pithoragarh, Sonitpur, Vishakhapatnam).

## Architecture

| Layer | What it is | Where it lives | Status |
|---|---|---|---|
| **Frontend** | React 19 + Vite 6, Mapbox GL, react-router-dom 7, framer-motion, recharts | this repo → deploy to Vercel/Cloudflare Pages | needs env + redeploy |
| **Backend** | FastAPI GIS service (`ps10_backend_service.py`) | HF Docker Space `yantrikaran-innovations/dronacharya-recce-backend` → `https://yantrikaran-innovations-dronacharya-recce-backend.hf.space` | **LIVE** |
| **Model** | **XGBoost** classifier + regressor (`xgb_classifier.json` / `xgb_regressor.json`) scoring terrain suitability per 100 m grid cell | inside the R2 asset bundle, lazy-loaded by the backend | **LIVE** |
| **GIS assets** | ~4.7 GB rasters (DEM, ESA landcover, surface water, soil), OSM vectors (roads/water/buildings), feature parquets | **Cloudflare R2** bucket `dronacharya-recce-assets` | **LIVE** |
| **Database** | Postgres — saved missions, reports, drone missions, battery allocations | **Supabase** | ⚠️ **DIED** (free-tier pause after inactivity) → recreate |

**Only Supabase needs rebuilding.** The HF backend + R2 assets + XGBoost model are
still up (verified `/api/health` → 200). The frontend just needs to be pointed at a
fresh Supabase project and redeployed.

## Database schema (Supabase)

Four tables — all keyed by `uuid`, linked by `mission_id`. Full DDL is in
[`supabase_schema.sql`](supabase_schema.sql):

- **`missions`** — a saved analysis run: AOI GeoJSON, gun/battery params, bearing,
  day/night, season, threat level, and the `analysis_summary` JSON.
- **`reports`** — a generated report tied to a mission: ranked candidates, route
  summary, risk summary, final recommendation.
- **`drone_missions`** — a drone recce plan for a candidate: waypoints + route.
- **`battery_allocations`** — which battery went to which candidate + score.

The app talks to these via [`src/lib/db.js`](src/lib/db.js)
(`saveMission`, `loadMissions`, `saveReport`, `saveDroneRecceMission`,
`saveBatteryAllocation`) using the Supabase anon key
([`src/lib/supabase.js`](src/lib/supabase.js)). If the env vars are absent the
client is `null` and the app runs read-only (no saving) without crashing.

## Reviving it — step by step

### 1. New Supabase project
1. supabase.com → **New project** (new account is fine). Region: Mumbai `ap-south-1`.
2. **SQL Editor** → paste all of [`supabase_schema.sql`](supabase_schema.sql) → **Run**.
   (It drops any old tables first, then creates the four clean ones.)
3. **Project Settings → API** → copy the **Project URL** and the **anon / publishable** key.

> The schema leaves RLS disabled, so the anon key can read/write these tables —
> that's how it worked before. To lock it down instead, see "Hardening" below.

### 2. Frontend env vars
Copy [`.env.example`](.env.example) → `.env` and fill in:

```
VITE_API_BASE=https://yantrikaran-innovations-dronacharya-recce-backend.hf.space
VITE_SUPABASE_URL=https://<new-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<new anon/publishable key>
VITE_MAPBOX_TOKEN=pk.<your mapbox public token>
```

Then `npm install && npm run dev`. Saving a mission and reloading it confirms the DB works.

### 3. ⚠️ Fix backend CORS for production
The Space currently allows only `localhost` origins
([`ps10_backend_service.py`](../hf-dronacharya-recce-backend/ps10_backend_service.py) → `allow_origins`).
When you deploy the frontend, add its URL (e.g. `https://your-app.vercel.app`) to that
list and push the Space again — otherwise the browser blocks every backend call.
(Because `allow_credentials=True`, you can't use the wildcard `"*"` together with it;
list the explicit origin, or set `allow_credentials=False` and use `["*"]`.)

### 4. Deploy the frontend
Push to Vercel/Cloudflare Pages, set the same four env vars in the project's
**Environment Variables**, and redeploy. Local `.env` does **not** apply to the
hosted build.

### 5. Keep it from dying again (important — this caused the outage)
Supabase free projects pause after ~7 days idle and HF Spaces sleep after ~48 h.
This project has its **own** keep-alive worker in [`keepalive-worker/`](keepalive-worker/)
(separate from Smart Property's). Its backend URL + this project's Supabase URL/key
are already filled in — just deploy it as a Cloudflare Worker with a `0 */12 * * *`
cron (see [`keepalive-worker/README.md`](keepalive-worker/README.md)).

Auto-pruning (built into `supabase_schema.sql`) then keeps each table capped at
its newest 100 rows, so the database can never approach the 500 MB free limit.

## Hardening (optional)
Enable RLS + minimal policies so the anon key can only insert/select:

```sql
alter table missions            enable row level security;
alter table reports             enable row level security;
alter table drone_missions      enable row level security;
alter table battery_allocations enable row level security;

-- repeat this pair for each of the four tables:
create policy "anon insert" on missions for insert to anon with check (true);
create policy "anon read"   on missions for select to anon using (true);
```

## Backend reference (no action needed unless recreating the Space)
- Space secrets: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
- Space variables: `R2_BUCKET=dronacharya-recce-assets`, `R2_ENDPOINT=https://<account>.r2.cloudflarestorage.com`, `PS10_BASE_DIR=/tmp/dronacharya-recce-assets`.
- Assets lazy-download from R2 on first use; `/tmp` is wiped on restart and re-fetched.
- Key endpoints: `/api/health`, `/api/districts`, `/api/districts/{d}/candidates`,
  `/api/districts/{d}/suitability-points`, `/api/predict`,
  `/api/districts/{d}/mission-analysis`, `/api/routes/plan`, `/api/drone/mission`,
  raster tiles at `/api/districts/{d}/layer/{layer}/tile/{z}/{x}/{y}.png`.
