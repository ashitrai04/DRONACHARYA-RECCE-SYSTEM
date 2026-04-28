// Build a KML document from the current mission state and trigger a browser
// download. Pure-JS, no library needed — generates KML 2.2 with Placemarks for
// each candidate, the AOI polygon, the assembly area, and any planned routes.

function escapeXml(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function ratingColor(rating) {
  // KML colors are AABBGGRR (alpha+BGR, hex)
  if (rating === "GREEN")  return "ff22c55e".match(/.{2}/g).reverse().join("");
  if (rating === "AMBER")  return "fff59e0b".match(/.{2}/g).reverse().join("");
  if (rating === "RED")    return "ffef4444".match(/.{2}/g).reverse().join("");
  return "ff38bdf8".match(/.{2}/g).reverse().join("");
}

function geometryToKml(geometry) {
  if (!geometry) return "";
  const { type, coordinates } = geometry;
  if (type === "Polygon") {
    const outer = coordinates?.[0] || [];
    const ring = outer.map((c) => `${c[0]},${c[1]},0`).join(" ");
    return `<Polygon><outerBoundaryIs><LinearRing><coordinates>${ring}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
  }
  if (type === "MultiPolygon") {
    return coordinates
      .map((poly) => geometryToKml({ type: "Polygon", coordinates: poly }))
      .join("");
  }
  if (type === "LineString") {
    const ring = coordinates.map((c) => `${c[0]},${c[1]},0`).join(" ");
    return `<LineString><coordinates>${ring}</coordinates></LineString>`;
  }
  return "";
}

export function buildMissionKml({
  mission,
  district,
  candidates = [],
  routes = {},
  aoi = null,
  assemblyArea = null,
}) {
  const styleBlocks = `
    <Style id="aoi"><LineStyle><color>ff38bdf8</color><width>3</width></LineStyle><PolyStyle><color>2238bdf8</color></PolyStyle></Style>
    <Style id="cand-green"><IconStyle><color>${ratingColor("GREEN")}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/grn-circle.png</href></Icon></IconStyle></Style>
    <Style id="cand-amber"><IconStyle><color>${ratingColor("AMBER")}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-circle.png</href></Icon></IconStyle></Style>
    <Style id="cand-red"><IconStyle><color>${ratingColor("RED")}</color><scale>1.1</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href></Icon></IconStyle></Style>
    <Style id="route"><LineStyle><color>ff22c55e</color><width>4</width></LineStyle></Style>
    <Style id="assembly"><IconStyle><color>fff59e0b</color><scale>1.2</scale><Icon><href>http://maps.google.com/mapfiles/kml/paddle/ylw-stars.png</href></Icon></IconStyle></Style>
  `;

  const aoiPlacemark = aoi?.features?.length
    ? aoi.features.map((feat) => `
      <Placemark>
        <name>${escapeXml(feat.properties?.name || "AOI")}</name>
        <styleUrl>#aoi</styleUrl>
        ${geometryToKml(feat.geometry)}
      </Placemark>
    `).join("")
    : "";

  const assemblyPlacemark = assemblyArea ? `
    <Placemark>
      <name>${escapeXml(assemblyArea.name || "Assembly Area")}</name>
      <description><![CDATA[Grid Ref: ${escapeXml(assemblyArea.gridRef || "—")}]]></description>
      <styleUrl>#assembly</styleUrl>
      <Point><coordinates>${assemblyArea.lng},${assemblyArea.lat},0</coordinates></Point>
    </Placemark>
  ` : "";

  const candidatePlacemarks = candidates.map((c) => {
    const styleId = c.rating === "GREEN" ? "cand-green" : c.rating === "AMBER" ? "cand-amber" : "cand-red";
    const desc = `
      <![CDATA[
        <h3>Area ${escapeXml(c.name)} — ${escapeXml(c.rating)} (${c.totalScore})</h3>
        <p>Slope: ${c.terrain?.avgSlope ?? "—"}° · Elevation: ${c.elevation ?? "—"} m ASL · Soil: ${escapeXml(c.terrain?.soilType || "—")}</p>
        <p>Road: ${c.access?.nearestRoadDist ?? "—"} m (${escapeXml(c.access?.roadType || "—")})</p>
        <p>Civilian: nearest building ${c.threats?.nearestBuildingDist ?? "—"} m, settlement ${c.threats?.nearestSettlementDist ?? "—"} m</p>
        <p>Land cover: ${escapeXml(c.terrain?.landCoverClass || "—")} · Firing arc clear ${c.terrain?.firingArcClearDeg ?? "—"}°</p>
      ]]>
    `;
    return `
      <Placemark>
        <name>Area ${escapeXml(c.name)} (${c.totalScore})</name>
        <description>${desc}</description>
        <styleUrl>#${styleId}</styleUrl>
        <Point><coordinates>${c.lng},${c.lat},0</coordinates></Point>
      </Placemark>
    `;
  }).join("");

  const routePlacemarks = Object.entries(routes || {}).map(([id, route]) => {
    if (!route?.route?.features) return "";
    return route.route.features.map((feat, idx) => `
      <Placemark>
        <name>Route to candidate ${escapeXml(id)} (segment ${idx + 1})</name>
        <styleUrl>#route</styleUrl>
        ${geometryToKml(feat.geometry)}
      </Placemark>
    `).join("");
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escapeXml(mission?.name || "Dronacharya Mission")} — ${escapeXml(district || "")}</name>
    <description>Generated by Dronacharya Recce System · ${new Date().toISOString()}</description>
    ${styleBlocks}
    ${aoiPlacemark}
    ${assemblyPlacemark}
    ${candidatePlacemarks}
    ${routePlacemarks}
  </Document>
</kml>`;
}

export function downloadKml(kmlText, filename = "mission.kml") {
  const blob = new Blob([kmlText], { type: "application/vnd.google-earth.kml+xml" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}
