// React hooks — live data from the PS-10 backend.
// Drop these in instead of importing CANDIDATES / DEOLALI_CENTER / MISSION_AOI from simulationData.js.

import { useEffect, useState, useCallback } from "react";
import { api } from "./client";

// Pick the first available district as the default; lets the UI start before user chooses one.
export function useDistricts() {
  const [districts, setDistricts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  useEffect(() => {
    let mounted = true;
    api.listDistricts()
      .then((d) => { if (mounted) setDistricts(d); })
      .catch((e) => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  return { districts, loading, error };
}

// Per-district candidates (rich, webapp-shape) + auto-refresh on district change.
export function useCandidates(district, opts = { n: 50, enriched: true, minScore: 0 }) {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (!district) return;
    let mounted = true;
    setLoading(true);
    api.candidates(district, opts)
      .then((res) => { if (mounted) setCandidates(res.candidates || []); })
      .catch((e) => { if (mounted) setError(e.message); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, [district, opts.n, opts.enriched, opts.minScore]);
  return { candidates, loading, error };
}

// Available raster overlay layers for a district + tile-URL helper.
export function useLayers(district) {
  const [layers, setLayers] = useState([]);
  useEffect(() => {
    if (!district) return;
    let mounted = true;
    api.layers(district).then((res) => { if (mounted) setLayers(res.layers || []); });
    return () => { mounted = false; };
  }, [district]);
  return layers;
}

// On-demand point predict (for "click a spot on the map" UX).
export function usePredict() {
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const predict = useCallback(async ({ district, lat, lng }) => {
    setLoading(true);
    try {
      const r = await api.predict({ district, lat, lng });
      setPrediction(r);
      return r;
    } finally {
      setLoading(false);
    }
  }, []);
  return { prediction, predict, loading };
}
