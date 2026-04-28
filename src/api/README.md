# PS-10 webapp ↔ backend wiring

The backend is the FastAPI server in `backend-pipeline.ipynb` (run all cells; cell 8 launches uvicorn on `127.0.0.1:8000`).

## Quick start

1. Run the notebook → terminal shows `Server running at http://127.0.0.1:8000`.
2. Confirm it works: open http://127.0.0.1:8000/docs (interactive Swagger UI).
3. Start the webapp: `npm run dev` from `ps10-recce-app/`.
4. (Optional) override the backend URL via env: `VITE_API_BASE=https://api.example.com npm run dev`.

## Files

| File | Purpose |
|---|---|
| `client.js` | Low-level `fetch`/`POST` wrappers + `api.*` methods. Set `VITE_API_BASE` to point elsewhere. |
| `hooks.js` | React hooks: `useDistricts()`, `useCandidates(district, opts)`, `useLayers(district)`, `usePredict()`. |
| `mapLayers.js` | Mapbox helpers: `addBackendLayer(map, district, layer, opacity)`, `removeBackendLayer`, `setSuitabilityHeatmap(map, geojson)` for the points layer. |

## Replacing the static `simulationData.js`

`App.jsx` currently imports `CANDIDATES, DEOLALI_CENTER, MISSION_AOI` from `./data/simulationData`. Swap to live data:

```jsx
// At the top of App.jsx
import { useDistricts, useCandidates, useLayers } from "./api/hooks";
import { api } from "./api/client";
import {
  addBackendLayer, removeBackendLayer,
  setSuitabilityHeatmap, BACKEND_LAYER_PRESETS,
} from "./api/mapLayers";

// Inside the component
const { districts } = useDistricts();
const [activeDistrict, setActiveDistrict] = useState("Ganganagar");
const { candidates, loading } = useCandidates(activeDistrict, { n: 50 });

// Initial map center: use the active district's centroid + bbox
const districtMeta = districts.find(d => d.name === activeDistrict);
const initialCenter = districtMeta
  ? { lng: districtMeta.centroid.lng, lat: districtMeta.centroid.lat, zoom: 11 }
  : { lng: 73.8387, lat: 19.9432, zoom: 11 };
```

`candidates` already has the same shape as the old `CANDIDATES` array (`id`, `name`, `lat`, `lng`, `totalScore`, `rating`, `scores.*`, `terrain.*`, `access.*`, `threats.*`).

## Adding raster overlays to the map

```jsx
useEffect(() => {
  if (!map || !activeDistrict) return;
  // Show the slope layer at 65 % opacity
  addBackendLayer(map, activeDistrict, "slope", 0.65);
  return () => removeBackendLayer(map, "slope");
}, [map, activeDistrict]);
```

A "Layers" UI can iterate `BACKEND_LAYER_PRESETS` and toggle each.

## Adding the suitability heatmap

```jsx
useEffect(() => {
  if (!map || !activeDistrict) return;
  let cancelled = false;
  api.suitabilityPoints(activeDistrict, { minScore: 60, limit: 5000 })
    .then((gj) => { if (!cancelled) setSuitabilityHeatmap(map, gj); });
  return () => { cancelled = true; };
}, [map, activeDistrict]);
```

## Click-to-predict at any pixel

```jsx
const { predict } = usePredict();
useEffect(() => {
  if (!map) return;
  const handler = (e) => predict({
    district: activeDistrict, lat: e.lngLat.lat, lng: e.lngLat.lng,
  }).then((p) => console.log(p));
  map.on("click", handler);
  return () => map.off("click", handler);
}, [map, activeDistrict]);
```

## Migration to cloud

| Component | Local | Cloud target |
|---|---|---|
| Model artefacts (`xgb_*.json`) | `xgb_model_output/` | Hugging Face Hub (versioned, downloaded on cold start) |
| Cached parquets / GeoJSON | `xgb_model_output/` | Cloudflare R2 (object storage) |
| Raster TIFs | `district_final_rasters/` | Cloudflare R2 — convert to **COG** (`gdal_translate -of COG -co COMPRESS=DEFLATE`) so `rio-tiler` can range-read |
| FastAPI server | uvicorn local | Cloudflare Workers (Python beta) **or** a small VM running uvicorn behind a CF tunnel |
| Telemetry / saved AOIs / users | none | Supabase (postgres + auth + storage) |
| Webapp | Vite dev | Cloudflare Pages |

Only `client.js` needs to change for the URL switch — set `VITE_API_BASE` in `.env.production` and the rest of the code is identical.
