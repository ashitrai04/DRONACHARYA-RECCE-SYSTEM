// Helpers for backend-served raster and GeoJSON layers.

import { API_BASE } from "./client";

export const BACKEND_LAYER_PRESETS = [
  { id: "elevation",         label: "Elevation (DEM)" },
  { id: "slope",             label: "Slope (deg)" },
  { id: "aspect",            label: "Aspect" },
  { id: "tri",               label: "Terrain Ruggedness (TRI)" },
  { id: "tpi",               label: "Topo Position (TPI)" },
  { id: "max_slope_local",   label: "Max slope 5×5" },
  { id: "flatness",          label: "Flatness 0–100" },
  { id: "ndvi_class",        label: "NDVI class" },
  { id: "landcover",         label: "ESA WorldCover" },
  { id: "moisture",          label: "Soil moisture class" },
  { id: "canopy_height",     label: "Canopy height class" },
  { id: "soil_4class",       label: "Soil 4-class" },
  { id: "soil_sand",         label: "Soil sand %" },
  { id: "soil_clay",         label: "Soil clay %" },
  { id: "soil_silt",         label: "Soil silt %" },
  { id: "water_occurrence",  label: "Water occurrence %" },
  { id: "water_seasonality", label: "Water seasonality" },
];

const _sourceId = (layer) => `ps10-${layer}`;
const _layerId  = (layer) => `ps10-${layer}-layer`;

export function addBackendLayer(map, district, layer, opacity = 0.7) {
  if (!map || !district || !layer) return;
  const url = `${API_BASE}/api/districts/${encodeURIComponent(district)}/layer/${layer}/tile/{z}/{x}/{y}.png`;
  if (map.getLayer(_layerId(layer))) removeBackendLayer(map, layer);
  map.addSource(_sourceId(layer), {
    type: "raster",
    tiles: [url],
    tileSize: 256,
    minzoom: 6,
    maxzoom: 18,
  });
  map.addLayer({
    id: _layerId(layer),
    type: "raster",
    source: _sourceId(layer),
    paint: { "raster-opacity": opacity },
  });
}

export function removeBackendLayer(map, layer) {
  if (!map) return;
  if (map.getLayer(_layerId(layer))) map.removeLayer(_layerId(layer));
  if (map.getSource(_sourceId(layer))) map.removeSource(_sourceId(layer));
}

export function setBackendLayerOpacity(map, layer, opacity) {
  if (map && map.getLayer(_layerId(layer))) {
    map.setPaintProperty(_layerId(layer), "raster-opacity", opacity);
  }
}

// Suitability heatmap from /suitability-points GeoJSON.
// Call once after the GeoJSON is fetched; updates the source if it already exists.
export function setSuitabilityHeatmap(map, geojson, { id = "suitability-heat", opacity = 0.7 } = {}) {
  if (!map) return;
  const src = map.getSource(id);
  if (src) {
    src.setData(geojson);
    return;
  }
  map.addSource(id, { type: "geojson", data: geojson });
  map.addLayer({
    id: `${id}-heat`,
    type: "heatmap",
    source: id,
    maxzoom: 14,
    paint: {
      "heatmap-weight": ["interpolate", ["linear"], ["get", "suitability"], 0, 0, 100, 1],
      "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 0, 1, 14, 3],
      "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 0, 2, 14, 24],
      "heatmap-opacity": opacity,
      "heatmap-color": [
        "interpolate", ["linear"], ["heatmap-density"],
        0, "rgba(0,0,0,0)",
        0.2, "rgba(178, 24, 43, 0.6)",   // red — reject
        0.4, "rgba(244, 165, 130, 0.7)", // amber — marginal
        0.6, "rgba(146, 197, 222, 0.7)", // blue — good
        0.85, "rgba(33, 102, 172, 0.85)",// strong blue — excellent
        1, "rgba(5, 48, 97, 0.95)",
      ],
    },
  });
  map.addLayer({
    id: `${id}-circles`,
    type: "circle",
    source: id,
    minzoom: 12,
    paint: {
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 1.5, 16, 5],
      "circle-color": [
        "step", ["get", "suit_class"],
        "#b91c1c",   0,
        "#f59e0b",   1,
        "#22c55e",   2,
        "#1d4ed8",
      ],
      "circle-opacity": 0.7,
      "circle-stroke-width": 0.5,
      "circle-stroke-color": "#0a0a0a",
    },
  });
}

export function removeSuitabilityHeatmap(map, id = "suitability-heat") {
  if (!map) return;
  for (const lid of [`${id}-heat`, `${id}-circles`]) {
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  if (map.getSource(id)) map.removeSource(id);
}

export function setGeoJsonSource(map, id, data) {
  if (!map) return;
  const existing = map.getSource(id);
  if (existing) {
    existing.setData(data);
    return;
  }
  map.addSource(id, { type: "geojson", data });
}

export function removeGeoJsonLayerGroup(map, { sourceId, layerIds }) {
  if (!map) return;
  [...layerIds].reverse().forEach((layerId) => {
    if (map.getLayer(layerId)) map.removeLayer(layerId);
  });
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

// Road styling tuned for the Mapbox HYBRID / SATELLITE basemap.
// Goals:
//   - Each road class is instantly recognisable at any zoom.
//   - All classes get a near-black casing under a saturated body so they pop
//     against green / brown / built terrain without washing out.
//   - Track (kachcha) is a distinct neon — most relevant for military approach.
const ROAD_CASE_ID = "ps10-roads-case";

// Per-class body width at zoom 14 (px). Lower class = thinner.
const ROAD_BODY_WIDTH = [
  "match", ["get", "fclass"],
  "motorway", 7.0,
  "trunk", 6.0,
  "primary", 5.0,
  "secondary", 4.0,
  "tertiary", 3.2,
  "unclassified", 2.4,
  "residential", 2.0,
  "service", 1.6,
  "track", 1.4,
  1.8,
];

// Body colour per class — high contrast against satellite imagery.
const ROAD_BODY_COLOR = [
  "match", ["get", "fclass"],
  "motorway",     "#ff1744",  // pure red — primary arteries impossible to miss
  "trunk",        "#ff6f00",  // amber-orange
  "primary",      "#ffd600",  // saturated yellow
  "secondary",    "#00e5ff",  // electric cyan
  "tertiary",     "#7c4dff",  // violet
  "unclassified", "#f8fafc",  // near-white
  "residential",  "#cbd5e1",  // light grey
  "service",      "#94a3b8",  // grey
  "track",        "#39ff14",  // neon green — kachcha tracks (off-road)
  "#e2e8f0",
];

export function setRoadVectorLayer(map, data, { sourceId = "ps10-roads", layerId = "ps10-roads-line" } = {}) {
  setGeoJsonSource(map, sourceId, data);

  // Universal dark casing — every road class gets a black outline so the body
  // colour reads cleanly against busy satellite tiles.
  if (!map.getLayer(ROAD_CASE_ID)) {
    map.addLayer({
      id: ROAD_CASE_ID,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": "#020617",   // slate-950, almost black
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          8,  ["*", ROAD_BODY_WIDTH, 0.55],
          12, ["*", ROAD_BODY_WIDTH, 1.2],
          15, ["*", ROAD_BODY_WIDTH, 1.9],
          18, ["*", ROAD_BODY_WIDTH, 2.6],
        ],
        "line-opacity": 0.85,
      },
    });
  }

  if (!map.getLayer(layerId)) {
    map.addLayer({
      id: layerId,
      type: "line",
      source: sourceId,
      layout: { "line-join": "round", "line-cap": "round" },
      paint: {
        "line-color": ROAD_BODY_COLOR,
        "line-width": [
          "interpolate", ["linear"], ["zoom"],
          8,  ["*", ROAD_BODY_WIDTH, 0.30],
          12, ["*", ROAD_BODY_WIDTH, 0.75],
          15, ROAD_BODY_WIDTH,
          18, ["*", ROAD_BODY_WIDTH, 1.7],
        ],
        "line-opacity": 0.98,
      },
    });
  }
}

export function removeRoadVectorLayer(map, { sourceId = "ps10-roads", layerId = "ps10-roads-line" } = {}) {
  if (!map) return;
  for (const lid of [layerId, ROAD_CASE_ID]) {
    if (map.getLayer(lid)) map.removeLayer(lid);
  }
  if (map.getSource(sourceId)) map.removeSource(sourceId);
}

// Optional helper for the LAYERS panel — exposes the legend so the UI can
// render small swatches matching what's drawn on the map.
export const ROAD_CLASS_LEGEND = [
  { fclass: "motorway",     label: "Motorway",     color: "#ff1744" },
  { fclass: "trunk",        label: "Trunk",        color: "#ff6f00" },
  { fclass: "primary",      label: "Primary",      color: "#ffd600" },
  { fclass: "secondary",    label: "Secondary",    color: "#00e5ff" },
  { fclass: "tertiary",     label: "Tertiary",     color: "#7c4dff" },
  { fclass: "unclassified", label: "Unclassified", color: "#f8fafc" },
  { fclass: "residential",  label: "Residential",  color: "#cbd5e1" },
  { fclass: "service",      label: "Service",      color: "#94a3b8" },
  { fclass: "track",        label: "Track (off-road)", color: "#39ff14" },
];

export function setBuildingVectorLayer(map, data, { sourceId = "ps10-buildings", fillId = "ps10-buildings-fill", lineId = "ps10-buildings-outline" } = {}) {
  setGeoJsonSource(map, sourceId, data);
  if (!map.getLayer(fillId)) {
    map.addLayer({
      id: fillId,
      type: "fill",
      source: sourceId,
      paint: {
        // Saturated red at low zoom (visibility), softer at high zoom (no clutter)
        "fill-color": "#f87171",
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.55, 15, 0.4, 18, 0.32],
      },
    });
  }
  if (!map.getLayer(lineId)) {
    map.addLayer({
      id: lineId,
      type: "line",
      source: sourceId,
      paint: {
        "line-color": "#dc2626",
        "line-width": ["interpolate", ["linear"], ["zoom"], 12, 0.6, 17, 1.2],
        "line-opacity": 0.85,
      },
    });
  }
}
