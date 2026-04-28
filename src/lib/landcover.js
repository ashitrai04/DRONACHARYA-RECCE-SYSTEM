// Single source of truth for ESA WorldCover 2021 land-cover classes.
// Imported by every UI component that renders land-cover swatches:
//   • AnalysisSidebar legend list
//   • Recharts donut chart
//   • Candidate detail panel
//   • Map legend bottom-right
// Backend may include a `color` field in classDistribution rows; if present
// it is used directly. Otherwise we fall back to ESA_LANDCOVER_COLORS[name].

export const ESA_LANDCOVER_COLORS = {
  Tree:         "#006400",
  Shrub:        "#FFBB22",
  Grass:        "#FFFF4C",
  Cropland:     "#F096FF",
  "Built-up":   "#FA0000",
  Bare:         "#B4B4B4",
  "Snow/Ice":   "#F0F0F0",
  Water:        "#0064C8",
  Wetland:      "#0096A0",
  Mangrove:     "#00CF75",
  "Moss/Lichen":"#FAE6A0",
  Unknown:      "#64748b",
};

// Display order for the legend / merged list — most common classes first.
export const ESA_CLASS_ORDER = [
  "Tree", "Shrub", "Grass", "Cropland", "Built-up", "Bare",
  "Water", "Wetland", "Mangrove", "Moss/Lichen", "Snow/Ice", "Unknown",
];

// Returns the canonical hex for a class, preferring the backend-supplied colour.
export function landcoverColor(name, fallback) {
  if (typeof fallback === "string" && fallback.length) return fallback;
  return ESA_LANDCOVER_COLORS[name] || ESA_LANDCOVER_COLORS.Unknown;
}

// Merge a backend distribution with the full ESA taxonomy so the legend always
// shows every class (those absent from the response render as 0.0%).
export function mergeFullTaxonomy(distribution) {
  const byName = new Map(
    (distribution || []).map((item) => [item.name, item])
  );
  return ESA_CLASS_ORDER.map((name) => {
    const found = byName.get(name);
    return {
      name,
      value: found ? Number(found.value) || 0 : 0,
      color: landcoverColor(name, found?.color),
      present: !!found,
    };
  }).sort((a, b) => b.value - a.value);
}

// Human-readable label for the source of a distribution.
export function sourceLabel(source) {
  if (source === "aoi") return "Selected AOI";
  if (source === "candidate_buffer") return "Candidate Buffer";
  if (source === "district") return "Full District";
  return "—";
}

// Dev-only debug helper. Pulls `import.meta.env.DEV` from Vite — turns into
// a no-op in production builds. Logs once per (district, source) tuple.
const _debugLogged = new Set();
export function debugLandcover(label, payload) {
  if (typeof import.meta === "undefined" || !import.meta.env?.DEV) return;
  const key = `${label}:${payload?.district || ""}:${payload?.landcoverSource || ""}`;
  if (_debugLogged.has(key)) return;
  _debugLogged.add(key);
  // eslint-disable-next-line no-console
  console.debug("[landcover]", label, payload);
}
