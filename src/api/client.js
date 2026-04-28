export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_BASE || "http://127.0.0.1:8000").replace(/\/+$/, "");
export const API_BASE = API_BASE_URL;

function _candidateApiBases() {
  const bases = [API_BASE_URL];
  if (API_BASE_URL.includes("127.0.0.1")) {
    bases.push(API_BASE_URL.replace("127.0.0.1", "localhost"));
  } else if (API_BASE_URL.includes("localhost")) {
    bases.push(API_BASE_URL.replace("localhost", "127.0.0.1"));
  }
  return [...new Set(bases)];
}

function _stripUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(_stripUndefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entryValue]) => entryValue !== undefined)
        .map(([key, entryValue]) => [key, _stripUndefined(entryValue)])
    );
  }
  return value;
}

async function _handleResponse(method, path, response) {
  if (response.ok) return response.json();

  let detail = "";
  try {
    const raw = await response.text();
    if (raw) {
      try {
        const payload = JSON.parse(raw);
        const errorDetail =
          payload?.detail ??
          payload?.message ??
          payload?.error ??
          raw;
        detail = errorDetail ? `: ${typeof errorDetail === "string" ? errorDetail : JSON.stringify(errorDetail)}` : "";
      } catch {
        detail = `: ${raw}`;
      }
    }
  } catch {
    detail = "";
  }
  throw new Error(`${method} ${path} -> ${response.status} ${response.statusText}${detail}`);
}

async function _get(path) {
  const urls = _candidateApiBases().map((base) => `${base}${path}`);
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url);
      return _handleResponse("GET", path, response);
    } catch (error) {
      lastError = error;
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }
  }
  const tried = urls.join(" , ");
  throw new Error(`GET ${path} -> failed to reach backend at ${tried}: ${lastError?.message || "Failed to fetch"}`);
}

async function _post(path, body) {
  const payload = _stripUndefined(body);
  const bodyJson = JSON.stringify(payload);
  const urls = _candidateApiBases().map((base) => `${base}${path}`);
  let lastError = null;
  for (const url of urls) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyJson,
      });
      return _handleResponse("POST", path, response);
    } catch (error) {
      lastError = error;
      if (!(error instanceof TypeError)) {
        throw error;
      }
    }
  }
  const tried = urls.join(" , ");
  throw new Error(`POST ${path} -> failed to reach backend at ${tried}: ${lastError?.message || "Failed to fetch"}`);
}

export const api = {
  capabilities: () => _get("/api/capabilities"),
  health: () => _get("/api/health"),
  metadata: () => _get("/api/metadata"),
  listDistricts: () => _get("/api/districts"),
  getDistrict: (name) => _get(`/api/districts/${encodeURIComponent(name)}`),
  candidates: (name, { n = 50, enriched = true, minScore = 0 } = {}) =>
    _get(
      `/api/districts/${encodeURIComponent(name)}/candidates?n=${n}` +
      `&enriched=${enriched}&min_score=${minScore}`
    ),
  suitabilityPoints: (name, { bbox, minScore = 0, limit = 20000 } = {}) => {
    const params = new URLSearchParams({ min_score: String(minScore), limit: String(limit) });
    if (bbox) params.set("bbox", bbox.join(","));
    return _get(
      `/api/districts/${encodeURIComponent(name)}/suitability-points?${params.toString()}`
    );
  },
  layers: (name) => _get(`/api/districts/${encodeURIComponent(name)}/layers`),
  landcoverDistribution: (name) =>
    _get(`/api/districts/${encodeURIComponent(name)}/landcover-distribution`),
  vectorLayers: (name) => _get(`/api/districts/${encodeURIComponent(name)}/vector-layers`),
  vectorLayer: (name, layer, { bbox, zoom } = {}) => {
    const params = new URLSearchParams();
    if (bbox) params.set("bbox", bbox.join(","));
    if (zoom != null) params.set("zoom", String(zoom));
    const query = params.toString();
    return _get(
      `/api/districts/${encodeURIComponent(name)}/vector/${encodeURIComponent(layer)}${query ? `?${query}` : ""}`
    );
  },
  predict: ({ district, lat, lng }) => _post("/api/predict", { district, lat, lng }),
  analyzeMission: (district, payload) =>
    _post(`/api/districts/${encodeURIComponent(district)}/mission-analysis`, payload),
  routePlan: (payload) => _post("/api/routes/plan", payload),
  droneMission: (payload) => _post("/api/drone/mission", payload),
  tileURL: (district, layer) =>
    `${API_BASE_URL}/api/districts/${encodeURIComponent(district)}/layer/${layer}/tile/{z}/{x}/{y}.png`,
};
