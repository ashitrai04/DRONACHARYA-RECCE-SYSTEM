// PS-10 live-data hooks — drives every nav tab from the FastAPI backend.
// Usage in App.jsx:
//   const live = useLiveMission(activeDistrict);          // meta + baseline candidates + layers
//   const analysis = useMissionAnalysis();                 // imperative POST /mission-analysis
//
// Shim consts in App.jsx prefer analysis.result.candidates if available, otherwise
// live.baselineCandidates, otherwise the static simulationData fallback.

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./client";
import * as Sim from "../data/simulationData";

function bboxToFeatureCollection(meta, district) {
  if (meta?.geometry) {
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { name: `${district} District Boundary` },
        geometry: meta.geometry,
      }],
    };
  }
  if (meta?.bbox) {
    const [minLng, minLat, maxLng, maxLat] = meta.bbox;
    return {
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: { name: `${district} District Boundary` },
        geometry: {
          type: "Polygon",
          coordinates: [[
            [minLng, minLat], [maxLng, minLat],
            [maxLng, maxLat], [minLng, maxLat], [minLng, minLat],
          ]],
        },
      }],
    };
  }
  return Sim.MISSION_AOI;
}

/* ──────────────────────────────────────────────────────────────────────────
 * useLiveMission(district)
 *  Fetches per-district context: bbox/centroid, raster + vector layer registries,
 *  capability handshake, model metadata, and a lightweight baseline of the top-50
 *  rule-derived candidates (NOT the full mission analysis — that's separate).
 * ────────────────────────────────────────────────────────────────────────── */
export function useLiveMission(district) {
  const [meta, setMeta]                 = useState(null);
  const [rasterLayers, setRasterLayers] = useState([]);
  const [vectorLayers, setVectorLayers] = useState([]);
  const [capabilities, setCapabilities] = useState(null);
  const [modelMetadata, setMetadata]    = useState(null);
  const [baseline, setBaseline]         = useState(null);
  const [landcoverDistribution, setLandcoverDistribution] = useState([]);
  const [landcoverTotalCells, setLandcoverTotalCells]     = useState(0);
  const [landcoverEncoding,    setLandcoverEncoding]      = useState(null);
  const [landcoverRawCodes,    setLandcoverRawCodes]      = useState([]);
  const [loading, setLoading]           = useState(false);
  const [error, setError]               = useState(null);

  useEffect(() => {
    if (!district) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMeta(null);
    setBaseline(null);
    setLandcoverDistribution([]);
    setLandcoverTotalCells(0);
    setLandcoverEncoding(null);
    setLandcoverRawCodes([]);

    Promise.all([
      api.getDistrict(district).catch(() => null),
      api.layers(district).catch(() => null),
      api.vectorLayers(district).catch(() => null),
      api.capabilities().catch(() => null),
      api.metadata().catch(() => null),
      api.candidates(district, { n: 50, enriched: false }).catch(() => null),
      api.landcoverDistribution(district).catch(() => null),
    ]).then(([dMeta, rasterRes, vectorRes, capsRes, metaRes, baseRes, landRes]) => {
      if (cancelled) return;
      setMeta(dMeta);
      setRasterLayers(rasterRes?.layers || []);
      setVectorLayers(vectorRes?.layers || []);
      setCapabilities(capsRes);
      setMetadata(metaRes);
      // baseRes here is a GeoJSON FeatureCollection (enriched=false branch)
      setBaseline(baseRes);
      setLandcoverDistribution(landRes?.distribution || []);
      setLandcoverTotalCells(landRes?.totalCells || 0);
      setLandcoverEncoding(landRes?.encoding || null);
      setLandcoverRawCodes(landRes?.rawCodes || []);
      // Dev-only debug for the user's request:
      if (typeof import.meta !== 'undefined' && import.meta.env?.DEV) {
        // eslint-disable-next-line no-console
        console.debug('[landcover] full-district response', {
          district,
          encoding: landRes?.encoding,
          totalCells: landRes?.totalCells,
          rawCodes: landRes?.rawCodes,
          distribution: landRes?.distribution,
        });
      }
      if (!dMeta) setError("Backend district metadata unavailable");
    }).catch((err) => {
      if (!cancelled) setError(err?.message || String(err));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [district]);

  return useMemo(() => {
    const isLive = !!meta;
    const center = meta?.centroid
      ? { lng: meta.centroid.lng, lat: meta.centroid.lat, zoom: 11 }
      : Sim.DEOLALI_CENTER;
    const supportsMissionAnalysis = capabilities?.missionAnalysis === true;
    const backendStatus = loading
      ? "syncing"
      : !isLive ? "offline"
      : supportsMissionAnalysis ? "live" : "legacy";

    // Convert baseline GeoJSON points into the lightweight CandidateCard shape so
    // the UI can render markers/cards even before the user runs full analysis.
    const baselineCandidates = baseline?.features?.length
      ? baseline.features.map((f, i) => {
          const [lng, lat] = f.geometry.coordinates;
          const score = Number(f.properties?.suitability ?? 0);
          const klass = Number(f.properties?.suit_class ?? 0);
          return {
            id: i + 1,
            name: i < 26 ? String.fromCharCode(65 + i) : `C${i + 1}`,
            district,
            lat, lng,
            elevation: 0,
            totalScore: Math.round(score * 10) / 10,
            rating: score >= 80 ? "GREEN" : score >= 60 ? "AMBER" : "RED",
            suit_class: klass,
            suit_class_label: ["reject", "marginal", "good", "excellent"][klass] || "unknown",
            scores: {}, terrain: { landCover: {}, soilType: "Unknown" },
            access: { nearestRoadDist: null }, threats: {},
            strengths: [], weaknesses: [], rejections: [],
          };
        })
      : null;

    return {
      isLive,
      loading,
      error,
      backendStatus,
      district,
      meta,
      capabilities,
      modelMetadata,
      center,
      missionAoi: bboxToFeatureCollection(meta, district),
      assemblyArea: isLive
        ? { lat: center.lat, lng: center.lng, name: `${district} Assembly Area`, gridRef: "—" }
        : Sim.ASSEMBLY_AREA,
      baselineCandidates,
      layersAvailable: rasterLayers,
      vectorLayersAvailable: vectorLayers,
      supportsMissionAnalysis,
      // Full-district ESA WorldCover histogram (not AOI-clipped) — used by the
      // Analysis sidebar so the chart is always meaningful even before the user
      // runs a mission analysis.
      landcoverDistribution,
      landcoverTotalCells,
      landcoverEncoding,        // "esa" | "compressed" | null
      landcoverRawCodes,        // [{code, fraction}, ...]
    };
  }, [meta, rasterLayers, vectorLayers, capabilities, modelMetadata, loading, error, district, baseline, landcoverDistribution, landcoverTotalCells, landcoverEncoding, landcoverRawCodes]);
}

/* ──────────────────────────────────────────────────────────────────────────
 * useMissionAnalysis()
 *  Imperative POST to /mission-analysis. Returns:
 *    { state, result, error, run(district, missionPayload) }
 *  state ∈ "idle" | "running" | "done" | "error".
 * ────────────────────────────────────────────────────────────────────────── */
export function useMissionAnalysis() {
  const [state, setState]   = useState("idle");
  const [result, setResult] = useState(null);
  const [error, setError]   = useState(null);
  const [progress, setProgress] = useState(0);

  const run = useCallback(async (district, payload) => {
    setState("running");
    setError(null);
    setProgress(5);
    // Fake progress ticker so the existing analysis-step UI animates while
    // the network call resolves. Real progress would need server-sent events.
    const ticker = setInterval(() => {
      setProgress((p) => Math.min(p + 8, 92));
    }, 700);
    try {
      const r = await api.analyzeMission(district, payload);
      clearInterval(ticker);
      setProgress(100);
      setResult(r);
      setState("done");
      return r;
    } catch (e) {
      clearInterval(ticker);
      setError(e?.message || String(e));
      setState("error");
      throw e;
    }
  }, []);

  const reset = useCallback(() => {
    setState("idle");
    setResult(null);
    setError(null);
    setProgress(0);
  }, []);

  return { state, result, error, progress, run, reset };
}

/* ──────────────────────────────────────────────────────────────────────────
 * Build the JSON body for /mission-analysis from the existing UI mission
 * params + optional drawn AOI.  Mirrors the Pydantic schema in
 * ps10_backend_service.MissionAnalysisRequest.
 * ────────────────────────────────────────────────────────────────────────── */
export function buildMissionPayload(mission, customAoi) {
  return {
    aoi: customAoi || null,                           // FeatureCollection or null = whole district
    gunType: mission.gunType ?? "DHANUSH",
    numGuns: mission.numGuns ?? 6,
    batteries: mission.batteries ?? 2,
    targetBearing: Number(mission.targetBearing ?? 45),
    dayNight: mission.dayNight ?? "Day",
    season: mission.season ?? "Post-Monsoon",
    threatLevel: mission.threatLevel ?? "Medium",
    limitCandidates: mission.limitCandidates ?? 8,
    minScore: Number(mission.minScore ?? 55),
  };
}
