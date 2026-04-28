import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import {
  Map as MapIcon, Crosshair, Navigation, BarChart2, FileText,
  Layers, Clock, Download, Share2, ChevronDown, ChevronUp,
  Mountain, Shield, Target, Trash2, Info, X,
  CheckCircle, AlertTriangle, XCircle, TrendingUp,
  MapPin, Zap, Settings, Pencil, Globe, Cpu, Plane,
  RotateCcw, PenTool,
} from 'lucide-react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
  ResponsiveContainer, PieChart, Pie, Cell, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from 'recharts';
import {
  MAPBOX_TOKEN, COMPANY, GUN_TYPES,
  DEOLALI_CENTER as STATIC_CENTER,
  MISSION_AOI as STATIC_AOI,
  ASSEMBLY_AREA as STATIC_ASSEMBLY,
  CANDIDATES as STATIC_CANDIDATES,
  ROUTES as STATIC_ROUTES,
  TERRAIN_STATS as STATIC_TERRAIN_STATS,
  SCORING_WEIGHTS,
  MISSION_DEFAULTS,
} from './data/simulationData';
import { useLiveMission } from './api/liveData';
import { api } from './api/client';
import {
  addBackendLayer, removeBackendLayer, setSuitabilityHeatmap, removeSuitabilityHeatmap,
  setRoadVectorLayer, setBuildingVectorLayer, removeGeoJsonLayerGroup,
  ROAD_CLASS_LEGEND,
} from './api/mapLayers';
import CompassInput from './components/CompassInput';
import { buildMissionKml, downloadKml } from './api/kmlExport';
import {
  ESA_LANDCOVER_COLORS, landcoverColor, mergeFullTaxonomy, sourceLabel,
  debugLandcover,
} from './lib/landcover';
import './index.css';
import brandLogo from '../yi (1).png';

const DISTRICT_OPTIONS = ['Ganganagar', 'Jaisalmer', 'Nashik', 'Pithoragarh', 'Sonitpur', 'Vishakhapatnam'];

// Expanded Indian Army artillery roster used by the Mission sidebar.
// Keys must match GUN_CONFIG in ps10_backend_service.py.
const INDIAN_ARMY_GUNS = {
  DHANUSH:  { icon: '🇮🇳', name: '155mm Dhanush',                       group: '155mm Towed' },
  SHARANG:  { icon: '🇮🇳', name: '155mm Sharang (130 M-46 upgrade)',    group: '155mm Towed' },
  ATAGS:    { icon: '🇮🇳', name: '155mm/52 ATAGS',                       group: '155mm Towed' },
  M777:     { icon: '🪂', name: 'M777 Ultra-Light Howitzer (155mm)',     group: '155mm Towed' },
  BOFORS:   { icon: '🛡️', name: 'FH-77B Bofors (155mm)',                 group: '155mm Towed' },
  M46:      { icon: '⚔️', name: '130mm M-46',                            group: '130mm' },
  IFG_105:  { icon: '🎯', name: '105mm Indian Field Gun (IFG)',          group: '105mm' },
  LFG_105:  { icon: '🎯', name: '105mm Light Field Gun (LFG)',           group: '105mm' },
  K9_VAJRA: { icon: '🛡️', name: 'K9 Vajra-T (Self-Propelled)',           group: 'Self-Propelled' },
  OTHER:    { icon: '⚙️', name: 'Other / Custom Platform',               group: 'Custom' },
};

// Top-level static fallbacks — helper components defined outside App() use these
// if not given a live override via props. Inside App() these names are shadowed
// by the live-data shim consts so the main UI updates with the active district.
const CANDIDATES      = STATIC_CANDIDATES;
const TERRAIN_STATS   = STATIC_TERRAIN_STATS;
const DEOLALI_CENTER  = STATIC_CENTER;
const MISSION_AOI     = STATIC_AOI;
const ASSEMBLY_AREA   = STATIC_ASSEMBLY;
const ROUTES          = STATIC_ROUTES;

const candidateAreaMetrics = (candidate) => {
  const area = candidate?.area || {};
  return {
    length: area.approx_length_m ?? area.length ?? 0,
    width: area.approx_width_m ?? area.width ?? 0,
    availableAreaM2: area.available_area_m2 ?? area.usableSqm ?? 0,
    availableAreaKm2: area.available_area_km2 ?? ((area.available_area_m2 ?? area.usableSqm ?? 0) / 1_000_000),
    analysisRadiusM: area.analysis_radius_m ?? null,
    extentType: area.analysis_extent_type ?? null,
  };
};

const candidateGunFit = (candidate) => candidate?.gunFit || {};
const candidateCanopyDensity = (candidate) => candidate?.terrain?.canopyDensityPercent ?? candidate?.terrain?.canopyDensity ?? 0;
const SHOW_DEBUG_METRICS = String(import.meta.env.VITE_SHOW_DEBUG_METRICS || '').toLowerCase() === 'true';

const downloadTextFile = (content, filename, mimeType) => {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, 0);
};

const canopyCoverLabel = (densityPercent) => {
  const density = Number(densityPercent || 0);
  if (density <= 20) return 'Low';
  if (density <= 50) return 'Moderate';
  if (density <= 80) return 'High';
  return 'Very High';
};

const candidateTreeCoverShare = (candidate) => {
  const landCover = candidate?.terrain?.landCover || {};
  return Object.entries(landCover).reduce((maxShare, [label, value]) => (
    /tree|forest/i.test(label) ? Math.max(maxShare, Number(value || 0)) : maxShare
  ), 0);
};

const concealmentQualityLabel = (candidate) => {
  const density = Number(candidateCanopyDensity(candidate) || 0);
  const coverSides = Number(candidate?.terrain?.coverSides || 0);
  const treeCoverShare = candidateTreeCoverShare(candidate);
  let score = 0;

  // Simple operational heuristic:
  // denser canopy improves concealment, while more covered sides improve masking.
  if (density > 20) score += 1;
  if (density > 50) score += 1;
  if (density > 80) score += 1;
  if (coverSides >= 2) score += 1;
  if (coverSides >= 4) score += 1;

  // If canopy appears unusually high while tree cover remains low, downgrade quietly.
  if (density >= 75 && treeCoverShare < 15) {
    score = Math.min(score, 2);
    if (SHOW_DEBUG_METRICS) {
      console.warn('[candidate-detail] canopy/landcover mismatch detected', {
        candidateId: candidate?.id,
        density,
        coverSides,
        treeCoverShare,
      });
    }
  }

  if (score >= 5) return 'Excellent';
  if (score >= 3) return 'Good';
  if (score >= 2) return 'Moderate';
  return 'Poor';
};

const candidateMissionKey = (candidate) => {
  if (candidate == null) return '';
  const rawId =
    candidate?.id ??
    candidate?.properties?.id ??
    candidate?.rank ??
    candidate?.properties?.rank;
  return rawId == null ? '' : String(rawId);
};

const droneMissionForCandidate = (missions, candidate) => {
  if (!missions || !candidate) return null;
  const key = candidateMissionKey(candidate);
  return missions[key] || missions[candidate?.id] || null;
};

const firstAvailableDroneMission = (missions) => Object.values(missions || {}).find(Boolean) || null;

const formatDistanceKm = (meters) => `${(Number(meters || 0) / 1000).toFixed(2)} km`;

const droneVerificationLabel = (droneMission) => {
  if (!droneMission) return 'Not Assigned';
  const verification = String(droneMission.verification_status || '').trim();
  return verification || 'Assigned';
};

const normalizeDeviceMissionUrl = (deviceInput) => {
  const trimmed = String(deviceInput || '').trim();
  if (!trimmed) return '';
  const base = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const sanitized = base.replace(/\/+$/, '');
  return /\/mission$/i.test(sanitized) ? sanitized : `${sanitized}/mission`;
};

mapboxgl.accessToken = MAPBOX_TOKEN;

/* ═══════════════════════════════════════════ */
/*  RASTER TILE STYLES (non-native)           */
/* ═══════════════════════════════════════════ */
const mkRaster = (id, tiles, attribution, maxzoom = 22, tileSize = 256) => ({
  version: 8,
  sources: { [id]: { type: 'raster', tiles, tileSize, attribution, maxzoom } },
  layers: [{ id: `${id}-layer`, type: 'raster', source: id, minzoom: 0, maxzoom }],
});

const ESRI_SAT    = mkRaster('esri',    ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],  '© Esri, Maxar');
const ESRI_TOPO   = mkRaster('esritopo',['https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}'],  '© Esri');
const OSM_STYLE   = mkRaster('osm',     ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], '© OpenStreetMap contributors', 19);
const TOPO_STYLE  = mkRaster('otm',     ['https://tile.opentopomap.org/{z}/{x}/{y}.png'],   '© OpenTopoMap', 17);
const CARTO_DARK  = mkRaster('cdark',   ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png','https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png'], '© CartoDB © OSM', 20, 512);
const CARTO_LIGHT = mkRaster('clight',  ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png','https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png'], '© CartoDB © OSM', 20, 512);

const MAP_STYLES = [
  /* ── SATELLITE ── */
  { id: 'satellite-streets', group: 'Satellite', label: 'Hybrid',     desc: 'Satellite + road labels',   icon: '🛰️', style: 'mapbox://styles/mapbox/satellite-streets-v12', native: true  },
  { id: 'satellite-raw',     group: 'Satellite', label: 'Imagery',    desc: 'Mapbox raw satellite',       icon: '📡', style: 'mapbox://styles/mapbox/satellite-v9',           native: true  },
  { id: 'satellite-esri',    group: 'Satellite', label: 'Esri Sat',   desc: 'Esri World Imagery',         icon: '🌍', style: ESRI_SAT,                                        native: false },
  /* ── TERRAIN ── */
  { id: 'outdoors',          group: 'Terrain',   label: 'Outdoors',   desc: 'Mapbox terrain + trails',    icon: '⛰️', style: 'mapbox://styles/mapbox/outdoors-v12',            native: true  },
  { id: 'esri-topo',         group: 'Terrain',   label: 'Esri Topo',  desc: 'Esri World Topo Map',        icon: '🗾', style: ESRI_TOPO,                                       native: false },
  { id: 'topo',              group: 'Terrain',   label: 'OpenTopo',   desc: 'OpenTopoMap contours',       icon: '🗻', style: TOPO_STYLE,                                      native: false },
  /* ── STREET / NIGHT ── */
  { id: 'dark',              group: 'Street',    label: 'Dark Ops',   desc: 'Night ops — dark mode',      icon: '🌙', style: 'mapbox://styles/mapbox/dark-v11',               native: true  },
  { id: 'carto-dark',        group: 'Street',    label: 'Carto Dark', desc: 'CartoDB Dark Matter',        icon: '🖤', style: CARTO_DARK,                                      native: false },
  { id: 'osm',               group: 'Street',    label: 'OSM',        desc: 'OpenStreetMap standard',     icon: '🗺️', style: OSM_STYLE,                                       native: false },
  { id: 'carto-light',       group: 'Street',    label: 'Carto Lite', desc: 'CartoDB light base',         icon: '🏙️', style: CARTO_LIGHT,                                     native: false },
];

/* ═══════════════════════════════════════════ */
/*  MAPBOX DRAW — CUSTOM MILITARY STYLES      */
/* ═══════════════════════════════════════════ */
const DRAW_STYLES = [
  { id: 'gl-draw-polygon-fill-inactive', type: 'fill',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
    paint: { 'fill-color': '#38bdf8', 'fill-outline-color': '#38bdf8', 'fill-opacity': 0.12 } },
  { id: 'gl-draw-polygon-fill-active', type: 'fill',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
    paint: { 'fill-color': '#38bdf8', 'fill-outline-color': '#38bdf8', 'fill-opacity': 0.18 } },
  { id: 'gl-draw-polygon-stroke-inactive', type: 'line',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Polygon'], ['!=', 'mode', 'static']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#38bdf8', 'line-width': 2, 'line-dasharray': [4, 2] } },
  { id: 'gl-draw-polygon-stroke-active', type: 'line',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#38bdf8', 'line-width': 2.5, 'line-dasharray': [4, 2] } },
  { id: 'gl-draw-line-inactive', type: 'line',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'LineString'], ['!=', 'mode', 'static']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#38bdf8', 'line-width': 2 } },
  { id: 'gl-draw-line-active', type: 'line',
    filter: ['all', ['==', 'active', 'true'], ['==', '$type', 'LineString']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#38bdf8', 'line-width': 2.5 } },
  { id: 'gl-draw-polygon-and-line-vertex-stroke-inactive', type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 6, 'circle-color': '#fff' } },
  { id: 'gl-draw-polygon-and-line-vertex-inactive', type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 4, 'circle-color': '#38bdf8' } },
  { id: 'gl-draw-point-point-stroke-inactive', type: 'circle',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 6, 'circle-opacity': 1, 'circle-color': '#fff' } },
  { id: 'gl-draw-point-inactive', type: 'circle',
    filter: ['all', ['==', 'active', 'false'], ['==', '$type', 'Point'], ['==', 'meta', 'feature'], ['!=', 'mode', 'static']],
    paint: { 'circle-radius': 4, 'circle-color': '#38bdf8' } },
  { id: 'gl-draw-point-stroke-active', type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'active', 'true'], ['!=', 'meta', 'midpoint']],
    paint: { 'circle-radius': 8, 'circle-color': '#fff' } },
  { id: 'gl-draw-point-active', type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['!=', 'meta', 'midpoint'], ['==', 'active', 'true']],
    paint: { 'circle-radius': 6, 'circle-color': '#38bdf8' } },
  { id: 'gl-draw-polygon-midpoint', type: 'circle',
    filter: ['all', ['==', '$type', 'Point'], ['==', 'meta', 'midpoint']],
    paint: { 'circle-radius': 3, 'circle-color': '#38bdf8' } },
];

/* ═══════════════════════════════════════════ */
/*  BOOT SEQUENCE OVERLAY                     */
/* ═══════════════════════════════════════════ */
const BOOT_LINES = [
  '> Initializing DRONACHARYA RECCE SYSTEM · AI-Powered Artillery Terrain Intelligence v2.4...',
  '> Loading terrain analysis modules [OK]',
  '> Connecting to satellite feed [LINKED]',
  '> Calibrating GPS reference grid [OK]',
  '> Loading district mission data [READY]',
  '> SegFormer-B5 neural engine online',
  '> CLASSIFICATION: SECRET — AUTHORIZED PERSONNEL ONLY',
];

function BootOverlay({ onComplete }) {
  const [visibleCount, setVisibleCount] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let i = 0;
    const interval = setInterval(() => {
      i++;
      setVisibleCount(i);
      setProgress(Math.min((i / BOOT_LINES.length) * 100, 100));
      if (i >= BOOT_LINES.length) {
        clearInterval(interval);
        setTimeout(onComplete, 700);
      }
    }, 320);
    return () => clearInterval(interval);
  }, [onComplete]);

  return (
    <motion.div className="boot-overlay"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 1.04 }}
      transition={{ duration: 0.7, ease: 'easeIn' }}
    >
      <div className="boot-grid-bg" />
      <div className="boot-scan-sweep" />

      <div className="boot-content">
        <motion.div className="boot-logo-ring"
          initial={{ scale: 0, rotate: -90, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        >
          <svg className="boot-ring-svg" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="56" fill="none" stroke="rgba(56,189,248,0.15)" strokeWidth="1" />
            <motion.circle cx="60" cy="60" r="56" fill="none" stroke="#38bdf8" strokeWidth="1.5"
              strokeDasharray="8 6" strokeLinecap="round"
              animate={{ rotate: 360 }} transition={{ duration: 12, repeat: Infinity, ease: 'linear' }}
              style={{ transformOrigin: '60px 60px' }}
            />
            <circle cx="60" cy="60" r="44" fill="none" stroke="rgba(56,189,248,0.3)" strokeWidth="0.5" strokeDasharray="2 3" />
          </svg>
          <div className="boot-logo-inner">
            <img src={brandLogo} alt="Dronacharya" />
          </div>
        </motion.div>

        <motion.h1 className="boot-title"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
        >
          DRONACHARYA <span className="boot-title-accent">RECCE SYSTEM</span>
        </motion.h1>

        <motion.div className="boot-subtitle"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          transition={{ delay: 0.45 }}
        >
          <Shield size={11} /> AI-Powered Artillery Terrain Intelligence Platform
        </motion.div>

        <div className="boot-terminal">
          <div className="boot-terminal-header">
            <span className="term-dot term-red" />
            <span className="term-dot term-amber" />
            <span className="term-dot term-green" />
            <span className="term-title">SECURE TERMINAL — DRONACHARYA OPS</span>
          </div>
          <div className="boot-messages">
            {BOOT_LINES.slice(0, visibleCount).map((msg, i) => (
              <motion.div key={i} className="boot-msg"
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
              >
                {msg}
              </motion.div>
            ))}
            {visibleCount < BOOT_LINES.length && (
              <div className="boot-cursor">█</div>
            )}
          </div>
        </div>

        <div className="boot-progress">
          <div className="boot-progress-track">
            <motion.div className="boot-progress-fill"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.25 }}
            />
          </div>
          <div className="boot-progress-text">
            <Cpu size={10} /> {Math.round(progress)}% · ARMING SYSTEMS
          </div>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════ */
/*  LIVE UTC CLOCK                            */
/* ═══════════════════════════════════════════ */
function UtcClock() {
  const [time, setTime] = useState('');
  useEffect(() => {
    const update = () => {
      const d = new Date();
      const h = d.getUTCHours().toString().padStart(2, '0');
      const m = d.getUTCMinutes().toString().padStart(2, '0');
      const s = d.getUTCSeconds().toString().padStart(2, '0');
      setTime(`${h}:${m}:${s}Z`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="utc-clock">
      <Clock size={11} />
      <span className="utc-time">{time}</span>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  UTILITY COMPONENTS                        */
/* ═══════════════════════════════════════════ */
function ScoreRing({ score, rating, size = 68 }) {
  const sw = 5;
  const r = (size - sw * 2) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (score / 100) * circ;
  const clr = { GREEN: '#22c55e', AMBER: '#f59e0b', RED: '#ef4444' }[rating] || '#38bdf8';
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(71,85,105,0.2)" strokeWidth={sw} />
        <motion.circle
          cx={size / 2} cy={size / 2} r={r}
          fill="none" stroke={clr} strokeWidth={sw}
          strokeDasharray={circ} strokeLinecap="round"
          initial={{ strokeDashoffset: circ }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.2, ease: 'easeOut', delay: 0.2 }}
          style={{ filter: `drop-shadow(0 0 5px ${clr}90)` }}
        />
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 17, fontWeight: 800, fontFamily: 'var(--font-mono)', color: clr, lineHeight: 1 }}>{score}</span>
        <span style={{ fontSize: 7, fontWeight: 700, color: clr, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 1 }}>{rating}</span>
      </div>
    </div>
  );
}

function AnimatedCounter({ to, duration = 1200 }) {
  const [val, setVal] = useState(0);
  const num = Number(to) || 0;
  useEffect(() => {
    if (num === 0) { setVal(0); return; }
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(eased * num));
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [num, duration]);
  return <>{val}</>;
}

/* ═══════════════════════════════════════════ */
/*  MAP STYLE PANEL                           */
/* ═══════════════════════════════════════════ */
function MapStylePanel({ activeMapStyle, setActiveMapStyle, terrain3D, onTerrain3D, mapboxNative }) {
  const [open, setOpen] = useState(false);
  const active = MAP_STYLES.find(s => s.id === activeMapStyle) || MAP_STYLES[0];
  const groups = [...new Set(MAP_STYLES.map(s => s.group))];

  return (
    <div className="map-style-panel">
      <div className="map-style-controls-row">
        <button className={`map-style-toggle-btn ${open ? 'is-open' : ''}`} onClick={() => setOpen(v => !v)}>
          <Layers size={12} />
          <span className="msp-label">{active.label}</span>
          {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
        <button
          className={`terrain-3d-btn ${terrain3D ? 'active' : ''} ${!mapboxNative ? 'disabled' : ''}`}
          onClick={mapboxNative ? onTerrain3D : undefined}
          title={mapboxNative ? 'Toggle 3D terrain' : '3D terrain requires a Mapbox native style'}
        >
          <Mountain size={12} /> 3D
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            className="map-style-dropdown"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {groups.map(group => (
              <div key={group} className="style-group-block">
                <div className="style-group-title">{group}</div>
                <div className="style-cards-grid">
                  {MAP_STYLES.filter(s => s.group === group).map(s => (
                    <button
                      key={s.id}
                      className={`style-card ${activeMapStyle === s.id ? 'active' : ''} ${!s.native ? 'non-native' : ''}`}
                      onClick={() => { setActiveMapStyle(s.id); setOpen(false); }}
                      title={s.desc}
                    >
                      <span className="style-card-icon">{s.icon}</span>
                      <span className="style-card-name">{s.label}</span>
                      <span className="style-card-desc">{s.desc}</span>
                      {!s.native && <span className="style-card-badge">EXT</span>}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  DRAW TOOLBAR (AOI polygon drawing)        */
/* ═══════════════════════════════════════════ */
function DrawToolbar({ drawMode, hasAOI, onToggleDraw, onClearAOI, onResetAOI }) {
  return (
    <div className="draw-toolbar">
      <div className="draw-toolbar-title">
        <Target size={11} /> AOI TOOLS
      </div>
      <div className="draw-toolbar-row">
        <motion.button
          className={`draw-btn ${drawMode ? 'active' : ''}`}
          onClick={onToggleDraw}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
          title="Draw custom AOI polygon"
        >
          <PenTool size={13} />
          <span>{drawMode ? 'Drawing...' : 'Draw AOI'}</span>
        </motion.button>

        <motion.button
          className="draw-btn draw-btn-secondary"
          onClick={onClearAOI}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
          disabled={!hasAOI && !drawMode}
          title="Clear drawn AOI"
        >
          <Trash2 size={13} />
          <span>Clear</span>
        </motion.button>

        <motion.button
          className="draw-btn draw-btn-secondary"
          onClick={onResetAOI}
          whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.95 }}
          title="Reset to default AOI"
        >
          <RotateCcw size={13} />
          <span>Reset</span>
        </motion.button>
      </div>
      {drawMode && (
        <motion.div className="draw-hint"
          initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}
        >
          Click to add vertices · double-click to finish
        </motion.div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  COORDINATE DISPLAY (on mouse hover)        */
/* ═══════════════════════════════════════════ */
function CoordDisplay({ coords }) {
  if (!coords) return null;
  return (
    <motion.div className="coord-display"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
    >
      <MapPin size={10} />
      <span className="coord-label">LAT</span>
      <span className="coord-val">{coords.lat}°</span>
      <span className="coord-sep">·</span>
      <span className="coord-label">LNG</span>
      <span className="coord-val">{coords.lng}°</span>
    </motion.div>
  );
}

/* (HUD slider widget removed — the user prefers to tune transparency
   manually in src/index.css. Look for the comment block titled
   `HUD-MODE TRANSPARENCY KNOBS` and edit --hud-alpha / --hud-blur there.) */

/* ═══════════════════════════════════════════ */
/*  MAIN APPLICATION                          */
/* ═══════════════════════════════════════════ */
export default function App() {
  const [bootDone, setBootDone] = useState(false);
  const [activeTab, setActiveTab] = useState('mission');
  const [activeDistrict, setActiveDistrict] = useState(DISTRICT_OPTIONS[2]);
  const live = useLiveMission(activeDistrict);
  const [mission, setMission] = useState(MISSION_DEFAULTS);
  const [analysisState, setAnalysisState] = useState('idle');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [terrain3D, setTerrain3D] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [detailCandidate, setDetailCandidate] = useState(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [globePhase, setGlobePhase] = useState('idle'); // 'idle'|'flying'|'done'
  const [activeMapStyle, setActiveMapStyle] = useState('satellite-streets');
  const [layers, setLayers] = useState({
    boundary: true,
    suitability: false,    // off by default — busy heatmap; user toggles when interested
    roads: true,
    buildings: false,
    candidates: true,
    slope: false,
    landcover: false,
  });
  const [allocations, setAllocations] = useState({});
  const [drawMode, setDrawMode] = useState(false);
  const [customAOI, setCustomAOI] = useState(null);
  const [mapCoords, setMapCoords] = useState(null);
  const [mapZoom, setMapZoom] = useState(2.8);
  const [plannedRoutes, setPlannedRoutes] = useState({});
  const [routeState, setRouteState] = useState('idle');
  const [routeError, setRouteError] = useState(null);
  const [routeCandidateId, setRouteCandidateId] = useState(null);
  const [routePulseOn, setRoutePulseOn] = useState(false);
  const [plannedDroneMissions, setPlannedDroneMissions] = useState({});
  const [droneState, setDroneState] = useState('idle');
  const [droneError, setDroneError] = useState(null);
  const [droneCandidateId, setDroneCandidateId] = useState(null);
  const [droneDeviceIp, setDroneDeviceIp] = useState('');
  const [droneSendState, setDroneSendState] = useState('idle');
  const [droneSendMessage, setDroneSendMessage] = useState(null);
  const MISSION_SUMMARY = analysisResult?.summary || null;
  const DEOLALI_CENTER = live.center || STATIC_CENTER;
  const MISSION_AOI    = analysisResult?.aoi || live.missionAoi;
  // Show analysis result if user clicked Analyze; else show lightweight baseline
  // candidates (rule-derived top-50 from `/candidates?enriched=false`) so the map
  // never looks empty when a district is selected.
  const CANDIDATES     = analysisResult?.candidates
                          ?? live.baselineCandidates
                          ?? [];
  const ROUTES         = plannedRoutes;
  // Terrain stats: prefer the AOI-clipped one from /mission-analysis. Forward
  // the new `landcoverSource` + `landcoverEncoding` so the Analysis sidebar can
  // label the donut chart correctly. When no analysis has run, fall back to
  // the full-district ESA WorldCover histogram from /landcover-distribution.
  const TERRAIN_STATS = (() => {
    const fullDistrict = live.landcoverDistribution && live.landcoverDistribution.length > 0
      ? live.landcoverDistribution
      : null;
    if (analysisResult?.terrainStats) {
      const aoi = analysisResult.terrainStats;
      // If the AOI breakdown is genuinely populated, keep it AS-IS (the source
      // label says "Selected AOI"). Don't blend with full-district unless the
      // backend returned essentially nothing.
      if ((aoi.classDistribution?.length || 0) >= 1) {
        return {
          ...aoi,
          landcoverSource: aoi.landcoverSource || 'aoi',
          landcoverEncoding: aoi.landcoverEncoding || live.landcoverEncoding || null,
        };
      }
      if (fullDistrict) {
        return {
          ...aoi,
          classDistribution: fullDistrict,
          landcoverSource: 'district',
          landcoverEncoding: live.landcoverEncoding || null,
        };
      }
      return aoi;
    }
    if (fullDistrict) {
      return {
        greenAreas: 0,
        amberAreas: 0,
        redAreas: 0,
        avgElevation: 0,
        dominantLandCover: fullDistrict[0]?.name || 'Unknown',
        classDistribution: fullDistrict,
        landcoverSource: 'district',
        landcoverEncoding: live.landcoverEncoding || null,
      };
    }
    return STATIC_TERRAIN_STATS;
  })();
  const isBaselineCandidates = !analysisResult && (live.baselineCandidates?.length || 0) > 0;
  const liveOpsLabel = customAOI ? 'Custom Polygon' : analysisResult ? 'Mission AOI' : `${activeDistrict} District Boundary`;
  const currentCandidate = CANDIDATES.find((candidate) => candidate.id === selectedCandidate) || CANDIDATES[0] || null;
  const currentRoute = currentCandidate ? plannedRoutes[currentCandidate.id] || plannedRoutes[String(currentCandidate.id)] || null : null;
  const routeLoading = routeState === 'loading' && currentCandidate && String(routeCandidateId) === String(currentCandidate.id);
  const routeFailure = routeState === 'error' && currentCandidate && String(routeCandidateId) === String(currentCandidate.id);
  const currentDroneMission = droneMissionForCandidate(plannedDroneMissions, currentCandidate);
  const droneLoading = droneState === 'loading' && currentCandidate && String(droneCandidateId) === String(currentCandidate.id);
  const droneFailure = droneState === 'error' && currentCandidate && String(droneCandidateId) === String(currentCandidate.id);

  const mapRef = useRef(null);
  const mapContainerRef = useRef(null);
  const markersRef = useRef([]);
  const droneMarkerRef = useRef(null);
  const prevMapStyleRef = useRef('satellite-streets');
  const drawRef = useRef(null);
  const applyLayersRef = useRef(null);
  const globeAnimStartedRef = useRef(false);

  const TABS = [
    { id: 'mission',   label: 'Mission',   icon: MapIcon },
    { id: 'analysis',  label: 'Analysis',  icon: Crosshair },
    { id: 'routes',    label: 'Routes',    icon: Navigation },
    { id: 'dashboard', label: 'Dashboard', icon: BarChart2 },
    { id: 'reports',   label: 'Reports',   icon: FileText },
  ];

  const currentAoiGeometry = customAOI?.geometry
    || analysisResult?.aoi?.features?.[0]?.geometry
    || live.meta?.geometry
    || null;

  /* ───── ANALYSIS ───── */
  const runAnalysis = useCallback(async () => {
    if (live.loading || !live.isLive || !activeDistrict) return;
    if (!live.supportsMissionAnalysis) {
      setAnalysisError('The running backend does not support AOI mission analysis. Stop the old notebook server and start `ps10_backend_service.py` on port 8000.');
      setAnalysisState('idle');
      return;
    }
    setAnalysisError(null);
    setAnalysisState('analyzing');
    setAnalysisProgress(15);
    try {
      const response = await api.analyzeMission(activeDistrict, {
        aoi: customAOI
          ? { type: 'Feature', geometry: customAOI.geometry, properties: customAOI.properties || {} }
          : live.meta?.geometry
            ? { type: 'Feature', geometry: live.meta.geometry, properties: { district: activeDistrict } }
            : null,
        gunType: mission.gunType,
        numGuns: mission.numGuns,
        batteries: mission.batteries,
        targetBearing: mission.targetBearing,
        dayNight: mission.dayNight,
        season: mission.season,
        threatLevel: mission.threatLevel,
        limitCandidates: 8,
        minScore: 55,
      });
      setAnalysisResult(response);
      setSelectedCandidate(response.candidates?.[0]?.id || null);
      setDetailCandidate(null);
      setPlannedRoutes({});
      setPlannedDroneMissions({});
      setRouteState('idle');
      setRouteError(null);
      setRouteCandidateId(null);
      setDroneState('idle');
      setDroneError(null);
      setDroneCandidateId(null);
      setDroneSendState('idle');
      setDroneSendMessage(null);
      setAnalysisProgress(100);
      setAnalysisState('done');
      setActiveTab('analysis');
    } catch (error) {
      console.error('mission-analysis failed', error);
      setAnalysisError(error?.message || String(error));
      setAnalysisState('idle');
      setAnalysisProgress(0);
    }
  }, [live.loading, live.isLive, live.supportsMissionAnalysis, activeDistrict, customAOI, live.meta, mission]);

  const planRouteForCandidate = useCallback(async (candidate) => {
    if (!candidate || !activeDistrict) return;
    if (!live.capabilities?.routePlanning) {
      setRouteCandidateId(candidate.id);
      setRouteState('error');
      setRouteError('The running backend does not expose /api/routes/plan. Start the FastAPI mission backend instead of the old notebook server.');
      setActiveTab('routes');
      return;
    }
    setRouteCandidateId(candidate.id);
    setRouteState('loading');
    setRouteError(null);
    setPlannedDroneMissions((prev) => {
      const next = { ...prev };
      delete next[candidateMissionKey(candidate)];
      return next;
    });
    setActiveTab('routes');
    try {
      const lng = Number(candidate?.lng);
      const lat = Number(candidate?.lat);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
        throw new Error('Selected candidate is missing valid longitude/latitude coordinates.');
      }
      const candidateId =
        candidate?.id ??
        candidate?.rank ??
        candidate?.properties?.id ??
        candidate?.properties?.rank;
      const routePayload = {
        district: activeDistrict,
        start: null,
        start_mode: 'nearest_highway',
        destination: {
          type: 'Point',
          coordinates: [lng, lat],
        },
        aoi: currentAoiGeometry || null,
        candidate_id: candidateId == null ? undefined : String(candidateId),
        vehicle_profile: 'standard',
        mode: 'terrain_aware_road',
      };
      console.log('[route-plan] payload', routePayload);
      let response;
      try {
        response = await api.routePlan(routePayload);
      } catch (firstError) {
        if (!routePayload.aoi) {
          throw firstError;
        }
        const fallbackPayload = { ...routePayload, aoi: null };
        console.warn('[route-plan] AOI-aware request failed, retrying without AOI context', firstError);
        console.log('[route-plan] fallback payload', fallbackPayload);
        response = await api.routePlan(fallbackPayload);
        if (response?.metrics) {
          const existingWarnings = Array.isArray(response.metrics.warnings) ? response.metrics.warnings : [];
          response = {
            ...response,
            metrics: {
              ...response.metrics,
              warnings: ['AOI context retry failed on backend; route computed without AOI boundary assistance.', ...existingWarnings],
            },
          };
        }
      }
      if (!response?.route || response.route.type !== 'FeatureCollection') {
        throw new Error('Backend route response is missing route GeoJSON.');
      }
      setPlannedRoutes((prev) => ({ ...prev, [candidate.id]: response }));
      setRouteState('done');
      setRouteError(null);
    } catch (error) {
      console.error('route-plan failed', error);
      setRouteState('error');
      setRouteError(error?.message || String(error));
    }
  }, [activeDistrict, currentAoiGeometry, live.capabilities]);

  const assignDroneRecce = useCallback(async (candidate) => {
    if (!candidate || !activeDistrict) return;
    if (!live.capabilities?.droneMission) {
      setDroneCandidateId(candidate.id);
      setDroneState('error');
      setDroneError('The running backend does not expose /api/drone/mission. Start the FastAPI mission backend instead of the old notebook server.');
      setActiveTab('routes');
      return;
    }

    const missionKey = candidateMissionKey(candidate);
    setSelectedCandidate(candidate.id);
    setDroneCandidateId(candidate.id);
    setDroneState('loading');
    setDroneError(null);
    setDroneSendState('idle');
    setDroneSendMessage(null);
    setActiveTab('routes');

    try {
      const dronePayload = {
        district: activeDistrict,
        candidate,
        route: plannedRoutes[candidate.id] || plannedRoutes[String(candidate.id)] || null,
        aoi: currentAoiGeometry || null,
        mode: 'route_verification',
      };
      console.log('[drone-mission] payload', dronePayload);
      const response = await api.droneMission(dronePayload);
      if (!response?.geojson || response.geojson.type !== 'FeatureCollection') {
        throw new Error('Backend drone mission response is missing mission GeoJSON.');
      }
      setPlannedDroneMissions((prev) => ({ ...prev, [missionKey]: response }));
      setDroneState('done');
      setDroneError(null);
    } catch (error) {
      console.error('drone-mission failed', error);
      setDroneState('error');
      setDroneError(error?.message || String(error));
    }
  }, [activeDistrict, currentAoiGeometry, live.capabilities, plannedRoutes]);

  const exportDroneMissionGeoJson = useCallback((droneMission, candidate) => {
    if (!droneMission?.geojson) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const candidateLabel = candidate ? `Area_${candidate.name}` : 'Drone_Mission';
    downloadTextFile(
      JSON.stringify(droneMission.geojson, null, 2),
      `${candidateLabel}_${activeDistrict}_${stamp}.geojson`,
      'application/geo+json',
    );
  }, [activeDistrict]);

  const exportDroneMissionKml = useCallback((droneMission, candidate) => {
    if (!droneMission?.kml) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const candidateLabel = candidate ? `Area_${candidate.name}` : 'Drone_Mission';
    downloadTextFile(
      droneMission.kml,
      `${candidateLabel}_${activeDistrict}_${stamp}.kml`,
      'application/vnd.google-earth.kml+xml',
    );
  }, [activeDistrict]);

  const sendDroneMissionToDevice = useCallback(async (droneMission) => {
    if (!droneMission) return;
    const url = normalizeDeviceMissionUrl(droneDeviceIp);
    if (!url) {
      setDroneSendState('error');
      setDroneSendMessage('Enter a device IP or mission endpoint before sending.');
      return;
    }

    setDroneSendState('loading');
    setDroneSendMessage(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_name: droneMission.mission_name,
          geojson: droneMission.geojson,
          kml: droneMission.kml,
        }),
      });
      if (!response.ok) {
        const raw = await response.text();
        throw new Error(raw || `${response.status} ${response.statusText}`);
      }
      setDroneSendState('done');
      setDroneSendMessage(`Mission sent to ${url}`);
    } catch (error) {
      console.error('drone mission send failed', error);
      setDroneSendState('error');
      setDroneSendMessage(error?.message || String(error));
    }
  }, [droneDeviceIp]);

  useEffect(() => {
    if (analysisResult) {
      setAnalysisState('done');
      setAnalysisProgress(100);
    } else if (!live.loading) {
      setAnalysisState('idle');
      setAnalysisProgress(0);
    }
  }, [analysisResult, live.loading]);

  useEffect(() => {
    setActiveTab('mission');
    setAnalysisState('idle');
    setAnalysisProgress(0);
    setAnalysisResult(null);
    setAnalysisError(null);
    setSelectedCandidate(null);
    setDetailCandidate(null);
    setAllocations({});
    setCustomAOI(null);
    setPlannedRoutes({});
    setPlannedDroneMissions({});
    setRouteState('idle');
    setRouteError(null);
    setRouteCandidateId(null);
    setDroneState('idle');
    setDroneError(null);
    setDroneCandidateId(null);
    setDroneSendState('idle');
    setDroneSendMessage(null);
    setMission((prev) => ({ ...prev, name: `Operation ${activeDistrict} Alpha-7` }));
  }, [activeDistrict]);

  useEffect(() => {
    if (!CANDIDATES.length) {
      setSelectedCandidate(null);
      setDetailCandidate(null);
      return;
    }
    if (!CANDIDATES.some((candidate) => candidate.id === selectedCandidate)) {
      setSelectedCandidate(CANDIDATES[0].id);
    }
    if (detailCandidate && !CANDIDATES.some((candidate) => candidate.id === detailCandidate)) {
      setDetailCandidate(null);
    }
  }, [CANDIDATES, selectedCandidate, detailCandidate]);

  useEffect(() => {
    if (activeTab !== 'routes' || !currentRoute) {
      setRoutePulseOn(false);
      return undefined;
    }
    setRoutePulseOn(true);
    const intervalId = window.setInterval(() => {
      setRoutePulseOn((previous) => !previous);
    }, 700);
    return () => window.clearInterval(intervalId);
  }, [activeTab, currentRoute]);

  useEffect(() => {
    setDroneSendState('idle');
    setDroneSendMessage(null);
  }, [currentCandidate?.id]);

  /* ───── OPERATIONAL LAYERS (AOI + routes) ─────
     - District boundary: solid RED line (so the user can see the working area at a glance).
     - Custom drawn AOI / mission-analysis AOI: dashed CYAN line + tinted fill.
     The two states are mutually exclusive — we update the source data and recolour
     the same layers via setPaintProperty rather than maintaining two layer pairs. */
  const applyOperationalLayers = useCallback((map) => {
    if (!map) return;
    const usingCustomAoi = !!customAOI || !!analysisResult?.aoi;
    const aoiData = customAOI
      ? { type: 'FeatureCollection', features: [customAOI] }
      : (analysisResult?.aoi || MISSION_AOI);
    if (!map.getSource('aoi')) {
      map.addSource('aoi', { type: 'geojson', data: aoiData });
    } else {
      map.getSource('aoi').setData(aoiData);
    }
    if (!map.getLayer('aoi-outline')) {
      map.addLayer({ id: 'aoi-outline', type: 'line', source: 'aoi',
        paint: { 'line-color': '#ef4444', 'line-width': 3, 'line-opacity': 0.9 } });
    }
    if (!map.getLayer('aoi-fill')) {
      map.addLayer({ id: 'aoi-fill', type: 'fill', source: 'aoi',
        paint: { 'fill-color': '#ef4444', 'fill-opacity': 0.05 } });
    }
    // Recolour based on whether we're showing the district boundary or a user-drawn AOI
    const lineColor = usingCustomAoi ? '#38bdf8' : '#ef4444';
    const fillColor = usingCustomAoi ? '#38bdf8' : '#ef4444';
    map.setPaintProperty('aoi-outline', 'line-color', lineColor);
    map.setPaintProperty('aoi-outline', 'line-width', usingCustomAoi ? 2 : 3);
    map.setPaintProperty('aoi-outline', 'line-dasharray', usingCustomAoi ? [4, 3] : [1, 0]);
    map.setPaintProperty('aoi-outline', 'line-opacity', usingCustomAoi ? 0.85 : 0.95);
    map.setPaintProperty('aoi-fill', 'fill-color', fillColor);
    map.setPaintProperty('aoi-fill', 'fill-opacity', usingCustomAoi ? 0.06 : 0.04);

    const route = currentRoute;
    if (route?.route?.type === 'FeatureCollection') {
      const routeData = route.route;
      if (!map.getSource('route-active')) {
        map.addSource('route-active', { type: 'geojson', data: routeData });
      } else {
        map.getSource('route-active').setData(routeData);
      }
      if (!map.getLayer('route-road-line')) {
        map.addLayer({
          id: 'route-road-line',
          type: 'line',
          source: 'route-active',
          filter: ['==', ['get', 'route_part'], 'road'],
          paint: { 'line-color': '#22c55e', 'line-width': 4, 'line-opacity': 0.9 },
        });
      }
      if (!map.getLayer('route-final-line')) {
        map.addLayer({
          id: 'route-final-line',
          type: 'line',
          source: 'route-active',
          filter: ['==', ['get', 'route_part'], 'final_access'],
          paint: { 'line-color': '#f59e0b', 'line-width': 3, 'line-opacity': 0.95, 'line-dasharray': [2, 2] },
        });
      }
      const startFeature = route?.auto_start
        ? { type: 'FeatureCollection', features: [route.auto_start] }
        : { type: 'FeatureCollection', features: [] };
      if (!map.getSource('route-start')) {
        map.addSource('route-start', { type: 'geojson', data: startFeature });
      } else {
        map.getSource('route-start').setData(startFeature);
      }
      if (!map.getLayer('route-start-circle')) {
        map.addLayer({
          id: 'route-start-circle',
          type: 'circle',
          source: 'route-start',
          paint: {
            'circle-radius': 7,
            'circle-color': '#f97316',
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 2,
          },
        });
      }
      map.setPaintProperty('route-road-line', 'line-color', routePulseOn ? '#7dd3fc' : '#22c55e');
      map.setPaintProperty('route-road-line', 'line-width', routePulseOn ? 7 : 4);
      map.setPaintProperty('route-road-line', 'line-opacity', routePulseOn ? 1 : 0.82);
      map.setPaintProperty('route-road-line', 'line-blur', routePulseOn ? 1.1 : 0.2);
      map.setPaintProperty('route-final-line', 'line-color', routePulseOn ? '#fde047' : '#f59e0b');
      map.setPaintProperty('route-final-line', 'line-width', routePulseOn ? 5 : 3);
      map.setPaintProperty('route-final-line', 'line-opacity', routePulseOn ? 1 : 0.92);
      map.setPaintProperty('route-start-circle', 'circle-radius', routePulseOn ? 10 : 7);
      map.setPaintProperty('route-start-circle', 'circle-color', routePulseOn ? '#fb7185' : '#f97316');
      map.setPaintProperty('route-start-circle', 'circle-opacity', routePulseOn ? 1 : 0.9);
    } else {
      if (map.getLayer('route-road-line')) map.removeLayer('route-road-line');
      if (map.getLayer('route-final-line')) map.removeLayer('route-final-line');
      if (map.getLayer('route-start-circle')) map.removeLayer('route-start-circle');
      if (map.getSource('route-active')) map.removeSource('route-active');
      if (map.getSource('route-start')) map.removeSource('route-start');
    }

    const droneMission = currentDroneMission;
    if (droneMission?.geojson?.type === 'FeatureCollection') {
      const missionData = droneMission.geojson;
      if (!map.getSource('drone-mission')) {
        map.addSource('drone-mission', { type: 'geojson', data: missionData });
      } else {
        map.getSource('drone-mission').setData(missionData);
      }
      if (!map.getLayer('drone-path-glow')) {
        map.addLayer({
          id: 'drone-path-glow',
          type: 'line',
          source: 'drone-mission',
          filter: ['==', ['get', 'feature_type'], 'survey_path'],
          paint: {
            'line-color': '#22d3ee',
            'line-width': 10,
            'line-opacity': 0.22,
            'line-blur': 2,
          },
        });
      }
      if (!map.getLayer('drone-path-line')) {
        map.addLayer({
          id: 'drone-path-line',
          type: 'line',
          source: 'drone-mission',
          filter: ['==', ['get', 'feature_type'], 'survey_path'],
          paint: {
            'line-color': '#67e8f9',
            'line-width': 3,
            'line-opacity': 0.95,
            'line-dasharray': [1.2, 1.1],
          },
        });
      }
      if (!map.getLayer('drone-waypoints-circle')) {
        map.addLayer({
          id: 'drone-waypoints-circle',
          type: 'circle',
          source: 'drone-mission',
          filter: ['==', ['geometry-type'], 'Point'],
          paint: {
            'circle-radius': [
              'match',
              ['get', 'type'],
              'candidate_center', 8,
              'candidate_orbit', 6,
              'risk_check', 6,
              'final_access', 6,
              5,
            ],
            'circle-color': [
              'match',
              ['get', 'type'],
              'candidate_center', '#f59e0b',
              'candidate_orbit', '#60a5fa',
              'risk_check', '#f43f5e',
              'final_access', '#fb7185',
              'route_start', '#34d399',
              '#67e8f9',
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#e2e8f0',
          },
        });
      }
      if (!map.getLayer('drone-waypoints-label')) {
        map.addLayer({
          id: 'drone-waypoints-label',
          type: 'symbol',
          source: 'drone-mission',
          filter: ['==', ['geometry-type'], 'Point'],
          layout: {
            'text-field': ['get', 'id'],
            'text-size': 10,
            'text-offset': [0, 1.5],
            'text-anchor': 'top',
            'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
            'text-allow-overlap': true,
          },
          paint: {
            'text-color': '#f8fafc',
            'text-halo-color': '#0f172a',
            'text-halo-width': 1.25,
          },
        });
      }

      const iconFeature = missionData.features.find((feature) => (
        feature?.geometry?.type === 'Point'
        && feature?.properties?.type === 'candidate_center'
      )) || missionData.features.find((feature) => feature?.geometry?.type === 'Point');

      if (iconFeature?.geometry?.coordinates?.length >= 2) {
        const [lng, lat] = iconFeature.geometry.coordinates;
        if (!droneMarkerRef.current) {
          const el = document.createElement('div');
          el.style.cssText = [
            'width:30px',
            'height:30px',
            'border-radius:999px',
            'display:flex',
            'align-items:center',
            'justify-content:center',
            'background:rgba(8,47,73,0.92)',
            'border:1px solid rgba(103,232,249,0.75)',
            'box-shadow:0 0 0 4px rgba(34,211,238,0.18)',
            'color:#67e8f9',
            'font-size:16px',
            'font-weight:800',
          ].join(';');
          el.textContent = '✈';
          droneMarkerRef.current = new mapboxgl.Marker({ element: el, anchor: 'center' })
            .setLngLat([lng, lat])
            .addTo(map);
        } else {
          droneMarkerRef.current.setLngLat([lng, lat]);
        }
      }
    } else {
      if (map.getLayer('drone-waypoints-label')) map.removeLayer('drone-waypoints-label');
      if (map.getLayer('drone-waypoints-circle')) map.removeLayer('drone-waypoints-circle');
      if (map.getLayer('drone-path-line')) map.removeLayer('drone-path-line');
      if (map.getLayer('drone-path-glow')) map.removeLayer('drone-path-glow');
      if (map.getSource('drone-mission')) map.removeSource('drone-mission');
      if (droneMarkerRef.current) {
        droneMarkerRef.current.remove();
        droneMarkerRef.current = null;
      }
    }

    const setVis = (id, v) => { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'); };
    const showMapMission = activeTab === 'mission' || activeTab === 'analysis' || activeTab === 'routes';
    setVis('aoi-outline', layers.boundary);
    setVis('aoi-fill', layers.boundary);
    setVis('route-road-line', activeTab === 'routes' && !!route);
    setVis('route-final-line', activeTab === 'routes' && !!route);
    setVis('route-start-circle', activeTab === 'routes' && !!route);
    setVis('drone-path-glow', showMapMission && !!droneMission);
    setVis('drone-path-line', showMapMission && !!droneMission);
    setVis('drone-waypoints-circle', showMapMission && !!droneMission);
    setVis('drone-waypoints-label', showMapMission && !!droneMission);
    if (droneMarkerRef.current) {
      droneMarkerRef.current.getElement().style.display = showMapMission && !!droneMission ? 'flex' : 'none';
    }
  }, [layers.boundary, customAOI, currentRoute, currentDroneMission, activeTab, analysisResult, MISSION_AOI, routePulseOn]);

  applyLayersRef.current = applyOperationalLayers;

  /* ───── BACKEND TILE LAYERS — slope / landcover ───── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !activeDistrict) return;
    if (layers.slope)     addBackendLayer(map, activeDistrict, 'slope', 0.55);
    else                  removeBackendLayer(map, 'slope');
    if (layers.landcover) addBackendLayer(map, activeDistrict, 'landcover', 0.5);
    else                  removeBackendLayer(map, 'landcover');
  }, [layers.slope, layers.landcover, mapLoaded, activeDistrict]);

  /* ───── BACKEND SUITABILITY HEATMAP ─────
     Prefers the AOI-clipped FeatureCollection from /mission-analysis.
     Falls back to a global /suitability-points fetch when no analysis has run yet,
     so the user sees coverage as soon as a district is loaded. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !activeDistrict) return;
    if (!layers.suitability) {
      removeSuitabilityHeatmap(map);
      return;
    }
    if (analysisResult?.suitabilityPoints) {
      setSuitabilityHeatmap(map, analysisResult.suitabilityPoints);
      return;
    }
    let cancelled = false;
    api.suitabilityPoints(activeDistrict, { minScore: 60, limit: 8000 })
      .then((gj) => { if (!cancelled && map) setSuitabilityHeatmap(map, gj); })
      .catch((e) => console.warn('suitability-points fallback failed', e));
    return () => { cancelled = true; };
  }, [layers.suitability, mapLoaded, activeDistrict, analysisResult]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !activeDistrict || !live.isLive) return undefined;

    let disposed = false;
    let requestToken = 0;

    const syncVectors = async () => {
      if (disposed) return;
      const bounds = map.getBounds();
      const bbox = [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth(),
      ];
      const zoom = Number(map.getZoom().toFixed(2));
      const token = ++requestToken;

      try {
        if (layers.roads) {
          const roads = await api.vectorLayer(activeDistrict, 'roads', { bbox, zoom });
          if (!disposed && token === requestToken) {
            setRoadVectorLayer(map, roads);
          }
        } else {
          removeGeoJsonLayerGroup(map, { sourceId: 'ps10-roads', layerIds: ['ps10-roads-line', 'ps10-roads-case'] });
        }

        if (layers.buildings) {
          const buildings = await api.vectorLayer(activeDistrict, 'buildings', { bbox, zoom });
          if (!disposed && token === requestToken) {
            setBuildingVectorLayer(map, buildings);
          }
        } else {
          removeGeoJsonLayerGroup(map, {
            sourceId: 'ps10-buildings',
            layerIds: ['ps10-buildings-outline', 'ps10-buildings-fill'],
          });
        }
      } catch (error) {
        if (!disposed) {
          console.warn('vector layer sync failed', error);
        }
      }
    };

    syncVectors();
    map.on('moveend', syncVectors);

    return () => {
      disposed = true;
      map.off('moveend', syncVectors);
      removeGeoJsonLayerGroup(map, { sourceId: 'ps10-roads', layerIds: ['ps10-roads-line', 'ps10-roads-case'] });
      removeGeoJsonLayerGroup(map, {
        sourceId: 'ps10-buildings',
        layerIds: ['ps10-buildings-outline', 'ps10-buildings-fill'],
      });
    };
  }, [mapLoaded, activeDistrict, live.isLive, layers.roads, layers.buildings]);

  /* ───── FLY TO ACTIVE DISTRICT WHEN IT CHANGES ───── */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !live.meta?.bbox) return;
    const [minLng, minLat, maxLng, maxLat] = live.meta.bbox;
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 60, duration: 1500 });
  }, [activeDistrict, mapLoaded, live.meta]);

  useEffect(() => {
    const map = mapRef.current;
    const feature = customAOI || analysisResult?.aoi?.features?.[0];
    if (!map || !mapLoaded || !feature?.geometry) return;
    const bounds = new mapboxgl.LngLatBounds();
    const pushCoords = (coords) => {
      if (!Array.isArray(coords)) return;
      if (typeof coords[0] === 'number' && typeof coords[1] === 'number') {
        bounds.extend(coords);
        return;
      }
      coords.forEach(pushCoords);
    };
    pushCoords(feature.geometry.coordinates);
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, { padding: 80, duration: 1100 });
    }
  }, [customAOI, analysisResult, mapLoaded]);

  /* ───── MAP INITIALIZATION (globe projection) ───── */
  useEffect(() => {
    if (mapRef.current || !mapContainerRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: 'mapbox://styles/mapbox/satellite-streets-v12',
      center: [78.9629, 22.5937], // India (wide view)
      zoom: 2.8,
      projection: 'globe',
      pitch: 0,
      bearing: 0,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl({ showCompass: true }), 'top-right');
    map.addControl(new mapboxgl.ScaleControl({ maxWidth: 180 }), 'bottom-right');

    map.on('mousemove', (e) => {
      setMapCoords({
        lng: e.lngLat.lng.toFixed(5),
        lat: e.lngLat.lat.toFixed(5),
      });
    });

    map.on('mouseout', () => setMapCoords(null));
    map.on('zoomend', () => setMapZoom(Number(map.getZoom().toFixed(2))));
    map.on('moveend', () => setMapZoom(Number(map.getZoom().toFixed(2))));

    map.on('load', () => {
      try {
        map.setFog({
          color: 'rgb(186, 210, 235)',
          'high-color': 'rgb(36, 92, 223)',
          'horizon-blend': 0.02,
          'space-color': 'rgb(11, 11, 25)',
          'star-intensity': 0.9,
        });
      } catch (e) { /* noop */ }
    });

    mapRef.current = map;
    return () => {
      try { map.remove(); } catch (e) {}
      mapRef.current = null;
    };
  }, []);

  /* ───── GLOBE INTRO ANIMATION (runs after boot) ───── */
  useEffect(() => {
    if (!bootDone || globeAnimStartedRef.current) return;

    const runIntro = (map) => {
      if (globeAnimStartedRef.current) return;
      globeAnimStartedRef.current = true;
      setGlobePhase('flying');

      setTimeout(() => {
        map.flyTo({
          center: [DEOLALI_CENTER.lng, DEOLALI_CENTER.lat],
          zoom: DEOLALI_CENTER.zoom,
          pitch: 30,
          bearing: -10,
          duration: 3400,
          essential: true,
        });

        map.once('moveend', () => {
          setTimeout(() => {
            try { map.setProjection({ name: 'mercator' }); } catch (e) {}
            try { map.setFog(null); } catch (e) {}
            setMapLoaded(true);
            setGlobePhase('done');
            applyLayersRef.current?.(map);
          }, 350);
        });
      }, 400);
    };

    const map = mapRef.current;
    if (!map) return;
    if (map.loaded()) {
      runIntro(map);
    } else {
      map.once('load', () => runIntro(map));
    }
  }, [bootDone]);

  /* ───── MAPBOX DRAW INITIALIZATION ───── */
  useEffect(() => {
    if (!mapLoaded || !mapRef.current || drawRef.current) return;

    const draw = new MapboxDraw({
      displayControlsDefault: false,
      controls: {},
      styles: DRAW_STYLES,
    });

    try {
      mapRef.current.addControl(draw);
      drawRef.current = draw;
    } catch (e) {
      return;
    }

    const onDrawCreate = (e) => {
      const feat = e.features[0];
      setAnalysisResult(null);
      setAnalysisError(null);
      setAnalysisState('idle');
      setAnalysisProgress(0);
      setPlannedRoutes({});
      setPlannedDroneMissions({});
      setRouteState('idle');
      setRouteError(null);
      setRouteCandidateId(null);
      setDroneState('idle');
      setDroneError(null);
      setDroneCandidateId(null);
      setCustomAOI(feat);
      setDrawMode(false);
    };
    const onDrawUpdate = (e) => {
      const feat = e.features[0];
      setAnalysisResult(null);
      setAnalysisError(null);
      setAnalysisState('idle');
      setAnalysisProgress(0);
      setPlannedRoutes({});
      setPlannedDroneMissions({});
      setRouteState('idle');
      setRouteError(null);
      setRouteCandidateId(null);
      setDroneState('idle');
      setDroneError(null);
      setDroneCandidateId(null);
      setCustomAOI(feat);
    };
    const onDrawDelete = () => {
      setAnalysisResult(null);
      setAnalysisError(null);
      setAnalysisState('idle');
      setAnalysisProgress(0);
      setPlannedRoutes({});
      setPlannedDroneMissions({});
      setRouteState('idle');
      setRouteError(null);
      setRouteCandidateId(null);
      setDroneState('idle');
      setDroneError(null);
      setDroneCandidateId(null);
      setCustomAOI(null);
    };
    const onModeChange = (e) => {
      if (e.mode !== 'draw_polygon') setDrawMode(false);
    };

    mapRef.current.on('draw.create', onDrawCreate);
    mapRef.current.on('draw.update', onDrawUpdate);
    mapRef.current.on('draw.delete', onDrawDelete);
    mapRef.current.on('draw.modechange', onModeChange);
  }, [mapLoaded]);

  /* ───── MARKERS ───── */
  const addMarkersToMap = useCallback(() => {
    if (!mapRef.current) return;
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];
    if (!layers.candidates || CANDIDATES.length === 0) return;

    CANDIDATES.forEach(c => {
      const colors = { GREEN: '#22c55e', AMBER: '#f59e0b', RED: '#ef4444' };
      const el = document.createElement('div');
      el.style.cssText = `width:32px;height:32px;border-radius:50%;background:${colors[c.rating]};border:3px solid white;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;color:white;font-family:'JetBrains Mono',monospace;cursor:pointer;box-shadow:0 2px 10px ${colors[c.rating]}66;transition:transform 0.15s;`;
      el.textContent = c.id;
      el.onmouseenter = () => { el.style.transform = 'scale(1.2)'; };
      el.onmouseleave = () => { el.style.transform = 'scale(1)'; };
      el.onclick = () => { setSelectedCandidate(c.id); };
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([c.lng, c.lat])
        .setPopup(new mapboxgl.Popup({ offset: 20, closeButton: false }).setHTML(
          `<div style="font-family:Inter,sans-serif;padding:6px;"><strong style="font-size:14px;">Area ${c.name}</strong><span style="float:right;font-weight:800;color:${colors[c.rating]};font-family:'JetBrains Mono';">${c.totalScore}</span><br/><span style="font-size:11px;color:#666;">${c.gridRef} · ${c.elevation}m</span></div>`
        ))
        .addTo(mapRef.current);
      markersRef.current.push(marker);
    });
  }, [layers.candidates, CANDIDATES, analysisResult]);

  /* ───── 3D TERRAIN ───── */
  const toggle3DTerrain = useCallback(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    if (!terrain3D) {
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.mapbox-terrain-dem-v1',
          tileSize: 512, maxzoom: 14,
        });
      }
      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      map.flyTo({ pitch: 65, duration: 1000 });
    } else {
      map.setTerrain(null);
      map.flyTo({ pitch: 30, duration: 800 });
    }
    setTerrain3D(t => !t);
  }, [terrain3D, mapLoaded]);

  /* ───── DRAW CONTROLS ───── */
  const toggleDraw = useCallback(() => {
    if (!drawRef.current) return;
    if (drawMode) {
      try { drawRef.current.changeMode('simple_select'); } catch (e) {}
      setDrawMode(false);
    } else {
      if (customAOI) {
        try { drawRef.current.deleteAll(); } catch (e) {}
        setCustomAOI(null);
      }
      try { drawRef.current.changeMode('draw_polygon'); } catch (e) {}
      setDrawMode(true);
    }
  }, [drawMode, customAOI]);

  const clearCustomAOI = useCallback(() => {
    if (drawRef.current) {
      try { drawRef.current.deleteAll(); } catch (e) {}
    }
    setAnalysisResult(null);
    setAnalysisError(null);
    setAnalysisState('idle');
    setAnalysisProgress(0);
    setPlannedRoutes({});
    setPlannedDroneMissions({});
    setRouteState('idle');
    setRouteError(null);
    setRouteCandidateId(null);
    setDroneState('idle');
    setDroneError(null);
    setDroneCandidateId(null);
    setCustomAOI(null);
    setDrawMode(false);
  }, []);

  const resetAOI = useCallback(() => {
    if (drawRef.current) {
      try { drawRef.current.deleteAll(); } catch (e) {}
    }
    setAnalysisResult(null);
    setAnalysisError(null);
    setAnalysisState('idle');
    setAnalysisProgress(0);
    setPlannedRoutes({});
    setPlannedDroneMissions({});
    setRouteState('idle');
    setRouteError(null);
    setRouteCandidateId(null);
    setDroneState('idle');
    setDroneError(null);
    setDroneCandidateId(null);
    setCustomAOI(null);
    setDrawMode(false);
    const map = mapRef.current;
    if (map) {
      map.flyTo({
        center: [DEOLALI_CENTER.lng, DEOLALI_CENTER.lat],
        zoom: DEOLALI_CENTER.zoom,
        pitch: 30, bearing: -10,
        duration: 1500,
      });
    }
  }, [DEOLALI_CENTER]);

  /* ───── STYLE CHANGE EFFECT ───── */
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    if (prevMapStyleRef.current === activeMapStyle) return;
    const selectedStyle = MAP_STYLES.find(s => s.id === activeMapStyle) || MAP_STYLES[0];
    setMapLoaded(false);
    if (terrain3D && !selectedStyle.native) {
      setTerrain3D(false);
    }
    mapRef.current.setStyle(selectedStyle.style);
    mapRef.current.once('style.load', () => {
      setMapLoaded(true);
      applyLayersRef.current?.(mapRef.current);
      if (analysisState === 'done') addMarkersToMap();
    });
    prevMapStyleRef.current = activeMapStyle;
  }, [activeMapStyle]);

  /* ───── LAYERS / MARKERS ───── */
  useEffect(() => {
    if (!mapRef.current || !mapLoaded) return;
    applyLayersRef.current?.(mapRef.current);
    // Render markers either after a successful analysis OR for the baseline preview
    if (analysisState === 'done' || CANDIDATES.length > 0) addMarkersToMap();
  }, [layers, mapLoaded, selectedCandidate, analysisState, addMarkersToMap, customAOI, CANDIDATES.length]);

  /* ───── FLY TO SELECTED CANDIDATE ───── */
  useEffect(() => {
    if (selectedCandidate && mapRef.current && globePhase === 'done') {
      const c = CANDIDATES.find(x => x.id === selectedCandidate);
      if (c) {
        mapRef.current.flyTo({
          center: [c.lng, c.lat], zoom: 14, pitch: 45,
          bearing: mission.targetBearing || 0, duration: 1500,
        });
      }
    }
  }, [selectedCandidate, globePhase, mission.targetBearing]);

  useEffect(() => {
    const map = mapRef.current;
    const isMapTab = activeTab === 'mission' || activeTab === 'analysis' || activeTab === 'routes';
    if (!map || !mapLoaded || !isMapTab) return;

    const restoreMap = () => {
      try {
        map.resize();
        applyLayersRef.current?.(map);
        if (analysisState === 'done' || CANDIDATES.length > 0) addMarkersToMap();
      } catch (error) {
        console.warn('map restore failed', error);
      }
    };

    const rafId = window.requestAnimationFrame(restoreMap);
    const timerId = window.setTimeout(restoreMap, 220);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
    };
  }, [activeTab, mapLoaded, analysisState, CANDIDATES.length, addMarkersToMap]);

  /* ═══════════════════════════════════════════ */
  /*  RENDER                                    */
  /* ═══════════════════════════════════════════ */
  return (
    <div className="app-layout">
      <AnimatePresence>
        {!bootDone && <BootOverlay onComplete={() => setBootDone(true)} />}
      </AnimatePresence>

      {/* ─── NAVBAR ─── */}
      <nav className="navbar">
        <div className="navbar-brand">
          <div className="brand-icon logo-frame">
            <img src={brandLogo} alt="Yi logo" className="brand-logo" />
          </div>
          <div className="brand-text">
            <span className="brand-name">DRONACHARYA RECCE SYSTEM</span>
            <span className="brand-product">
              <Shield size={9} /> AI-Powered Artillery Terrain Intelligence Platform · {COMPANY.name}
            </span>
          </div>
        </div>

        <div className="navbar-tabs">
          {TABS.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {activeTab === tab.id && (
                  <motion.div
                    layoutId="tab-pill"
                    className="tab-active-pill"
                    transition={{ type: 'spring', stiffness: 400, damping: 35 }}
                  />
                )}
                <span className="tab-icon-wrap"><Icon size={14} /></span>
                <span className="tab-label">{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="navbar-right">
          <div className="navbar-mission">
            <Target size={11} />
            <span className="nav-mission-name">{mission.name}</span>
          </div>
          <UtcClock />
          <div className={`status-indicator ${analysisState === 'done' ? 'is-done' : ''}`}>
            <motion.span
              className="status-dot"
              animate={{ scale: [1, 1.45, 1], opacity: [1, 0.5, 1] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <span>
              {live.backendStatus === 'syncing'
                ? 'SYNCING'
                : live.backendStatus === 'live'
                  ? 'LIVE'
                  : live.backendStatus === 'legacy'
                    ? 'LEGACY'
                    : 'OFFLINE'}
            </span>
          </div>
          <span className="version-badge">
            <Cpu size={9} /> {COMPANY.version}
          </span>
        </div>
      </nav>

      {/* ─── MAIN CONTENT ─── */}
      <div className="main-content">

        {/* ─── LEFT SIDEBAR ─── */}
        {(activeTab === 'mission' || activeTab === 'analysis') && (
          <aside className="sidebar">
            <AnimatePresence mode="wait">
              {activeTab === 'mission' ? (
                <motion.div key="mission-sb"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
                >
                  <MissionSidebar
                    mission={mission} setMission={setMission}
                    analysisState={analysisState} analysisProgress={analysisProgress}
                    runAnalysis={runAnalysis}
                    customAOI={customAOI}
                    activeDistrict={activeDistrict} setActiveDistrict={setActiveDistrict}
                    isLive={live.isLive} liveLoading={live.loading} liveError={live.error}
                    supportsMissionAnalysis={live.supportsMissionAnalysis}
                    backendStatus={live.backendStatus}
                    analysisError={analysisError}
                    setActiveTab={setActiveTab}
                  />
                </motion.div>
              ) : (
                <motion.div key="analysis-sb"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
                >
                  <AnalysisSidebar
                    candidates={CANDIDATES}
                    selectedCandidate={selectedCandidate}
                    setSelectedCandidate={setSelectedCandidate}
                    setDetailCandidate={setDetailCandidate}
                    setActiveTab={setActiveTab}
                    terrainStats={TERRAIN_STATS}
                    district={activeDistrict}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </aside>
        )}

        {/* ─── MAP ─── */}
        <div
          className="map-container"
          style={{ display: activeTab === 'mission' || activeTab === 'analysis' || activeTab === 'routes' ? 'block' : 'none' }}
        >
            <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />

            {/* HUD corners */}
            <div className="hud-corner hud-tl" />
            <div className="hud-corner hud-tr" />
            <div className="hud-corner hud-bl" />
            <div className="hud-corner hud-br" />

            {/* Globe intro badge (shows during fly-in) */}
            <AnimatePresence>
              {globePhase === 'flying' && (
                <motion.div className="globe-intro-badge"
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                >
                  <Globe size={13} />
                  <span>{`LOCKING ONTO ${activeDistrict.toUpperCase()} SECTOR`}</span>
                  <span className="globe-intro-dots">●●●</span>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Top-left chips */}
            <div className="map-overlay-top">
              <div className="map-chip">
                <div className="chip-dot" style={{ background: '#38bdf8' }} />
                <Target size={10} />
                <span>{`AOI: ${liveOpsLabel}`}</span>
              </div>
              {analysisState === 'done' && (
                <motion.div className="map-chip"
                  initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.3 }}
                >
                  <div className="chip-dot" style={{ background: '#22c55e' }} />
                  <CheckCircle size={10} />
                  <span>{CANDIDATES.length} Candidates</span>
                </motion.div>
              )}
              {terrain3D && (
                <motion.div className="map-chip" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <div className="chip-dot" style={{ background: '#f59e0b' }} />
                  <Mountain size={10} />
                  <span>3D Terrain</span>
                </motion.div>
              )}
            </div>

            {/* Top-right: map style panel */}
            <div className="map-style-panel-anchor">
              <MapStylePanel
                activeMapStyle={activeMapStyle}
                setActiveMapStyle={setActiveMapStyle}
                terrain3D={terrain3D}
                onTerrain3D={toggle3DTerrain}
                mapboxNative={MAP_STYLES.find(s => s.id === activeMapStyle)?.native ?? true}
              />
            </div>

            {/* Draw toolbar */}
            <DrawToolbar
              drawMode={drawMode}
              hasAOI={!!customAOI}
              onToggleDraw={toggleDraw}
              onClearAOI={clearCustomAOI}
              onResetAOI={resetAOI}
            />

            {/* Bottom-left layer panel — each toggle has a min-zoom hint so the
                user knows whether the data will actually render at the current view. */}
            <div className="layer-panel">
              <div className="layer-panel-title">
                <Layers size={10} /> <span>LAYERS</span>
                <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, opacity: 0.6 }}>
                  z{mapZoom.toFixed(1)}
                </span>
              </div>
              {[
                ['boundary',    'Boundary',    null,  'District boundary (red)'],
                ['suitability', 'Suitability', null,  'Score heatmap from /suitability-points'],
                ['roads',       'Roads',       8,     'OSM roads, styled per class'],
                ['buildings',   'Buildings',   12,    'OSM building footprints'],
                ['candidates',  'Candidates',  null,  'Top gun-area markers'],
                ['slope',       'Slope',       null,  'DEM slope (deg) tiles'],
                ['landcover',   'Landcover',   null,  'ESA WorldCover tiles'],
              ].map(([key, label, minZoom, hint]) => {
                const tooLowZoom = minZoom != null && mapZoom < minZoom;
                const showHint = layers[key] && tooLowZoom;
                return (
                  <div key={key} style={{ display: 'flex', flexDirection: 'column' }}>
                    <label className="layer-toggle" title={hint}>
                      <input type="checkbox" checked={layers[key]}
                        onChange={() => setLayers(l => ({ ...l, [key]: !l[key] }))} />
                      <span className={`layer-dot layer-dot-${key}`} />
                      {label}
                      {minZoom != null && (
                        <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)',
                                       fontSize: 9, color: tooLowZoom ? '#f59e0b' : 'var(--text-secondary)' }}>
                          z≥{minZoom}
                        </span>
                      )}
                    </label>
                    {showHint && (
                      <div style={{ fontSize: 9, color: '#f59e0b', marginLeft: 22, marginBottom: 2 }}>
                        Zoom in (current z={mapZoom.toFixed(1)}) to load {label.toLowerCase()}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Coordinate display (bottom-center) */}
            <CoordDisplay coords={mapCoords} />

{detailCandidate && (
              <DetailPanelOperational
                candidate={CANDIDATES.find(c => c.id === detailCandidate)}
                onClose={() => setDetailCandidate(null)}
                setActiveTab={setActiveTab}
                setSelectedCandidate={setSelectedCandidate}
                onPlanRoute={planRouteForCandidate}
                onAssignDrone={assignDroneRecce}
              />
            )}
          </div>

        {(activeTab === 'dashboard' || activeTab === 'reports') && (
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <AnimatePresence mode="wait">
              {activeTab === 'dashboard' && (
                <motion.div key="dashboard"
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}
                >
                  <DashboardViewEnhanced
                    candidates={CANDIDATES}
                    routes={ROUTES}
                    summary={MISSION_SUMMARY}
                    allocations={allocations} setAllocations={setAllocations}
                    mission={mission} setActiveTab={setActiveTab}
                    district={activeDistrict}
                    aoi={MISSION_AOI}
                    assemblyArea={ASSEMBLY_AREA}
                  />
                </motion.div>
              )}
              {activeTab === 'reports' && (
                <motion.div key="reports"
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.25 }}
                >
                  <ReportViewEnhanced
                    candidates={CANDIDATES}
                    routes={ROUTES}
                    droneMissions={plannedDroneMissions}
                    allocations={allocations}
                    mission={mission}
                    district={activeDistrict}
                    terrainStats={TERRAIN_STATS}
                    summary={MISSION_SUMMARY}
                    metadata={live.modelMetadata}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* ─── RIGHT: ANALYSIS RESULTS ─── */}
        {activeTab === 'analysis' && !detailCandidate && (
          <motion.div className="results-panel"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="results-header">
              <h3><Crosshair size={13} /> Ranked Gun Areas</h3>
              <div className="results-subtext">
                {analysisResult
                  ? `${mission.name} · ${activeDistrict} AOI results`
                  : `${activeDistrict} awaits AOI analysis`}
              </div>
            </div>
            <div className="results-body">
              {analysisResult ? <TerrainSummary terrainStats={TERRAIN_STATS} /> : null}
              {analysisResult && CANDIDATES.length ? CANDIDATES.map((c, i) => (
                <motion.div key={c.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07, duration: 0.3 }}
                >
                  <CandidateCard
                    candidate={c} rank={i + 1}
                    isSelected={selectedCandidate === c.id}
                    onClick={() => setSelectedCandidate(c.id)}
                    onDetail={() => setDetailCandidate(c.id)}
                    onRoute={() => { setSelectedCandidate(c.id); planRouteForCandidate(c); }}
                    onDrone={() => { setSelectedCandidate(c.id); assignDroneRecce(c); }}
                  />
                </motion.div>
              )) : (
                <div className="empty-state" style={{ minHeight: 220 }}>
                  <div className="empty-title">
                    {analysisState === 'analyzing'
                      ? 'Computing mission candidates'
                      : analysisError
                        ? 'Analysis failed'
                        : analysisResult
                          ? 'No candidates available'
                          : 'Run mission analysis'}
                  </div>
                  <div className="empty-description">
                    {analysisState === 'analyzing'
                      ? `Running AOI analysis for ${activeDistrict}. Larger district-wide jobs can take over a minute.`
                      : analysisError
                        ? analysisError
                        : analysisResult
                          ? `No candidate output was generated for ${activeDistrict}. Refine the AOI or mission constraints and run the analysis again.`
                          : `Draw an AOI or use the district boundary, then start AI PRE-SCREEN to compute real candidates, routes, and report content from the backend.`}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* ─── RIGHT: ROUTE PANEL ─── */}
        {activeTab === 'routes' && (
          <motion.div className="results-panel"
            initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3 }}
          >
            <div className="results-header">
              <h3><Navigation size={13} /> Route Planning</h3>
              <div className="results-subtext">Nearest major-road access → selected candidate</div>
            </div>
            <div className="results-body">
              <RouteViewEnhanced
                candidate={currentCandidate}
                route={currentRoute}
                loading={routeLoading}
                error={routeFailure ? routeError : null}
                onAssignDrone={assignDroneRecce}
                droneMission={currentDroneMission}
                droneLoading={droneLoading}
                droneError={droneFailure ? droneError : null}
                droneDeviceIp={droneDeviceIp}
                setDroneDeviceIp={setDroneDeviceIp}
                droneSendState={droneSendState}
                droneSendMessage={droneSendMessage}
                onExportGeoJson={exportDroneMissionGeoJson}
                onExportKml={exportDroneMissionKml}
                onSendMission={sendDroneMissionToDevice}
              />
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  MISSION SIDEBAR                           */
/* ═══════════════════════════════════════════ */
function MissionSidebar({ mission, setMission, analysisState, analysisProgress, runAnalysis, customAOI,
                          activeDistrict, setActiveDistrict, isLive, liveLoading, liveError,
                          supportsMissionAnalysis, backendStatus, analysisError, setActiveTab }) {
  return (
    <>
      <div className="sidebar-header">
        <h3><Settings size={13} /> Mission Parameters</h3>
      </div>
      <div className="sidebar-body">
        <div className="form-group">
          <label className="form-label">
            District (data source)
            <span style={{ marginLeft: 8, fontSize: 10, color: backendStatus === 'live' ? '#22c55e' : backendStatus === 'legacy' ? '#f59e0b' : '#94a3b8' }}>
              {liveLoading
                ? '⟳ syncing…'
                : backendStatus === 'live'
                  ? '● mission backend'
                  : backendStatus === 'legacy'
                    ? '● legacy backend'
                    : '○ offline'}
            </span>
          </label>
          <select className="form-select" value={activeDistrict}
            onChange={e => setActiveDistrict(e.target.value)}>
            {DISTRICT_OPTIONS.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Mission Name</label>
          <input className="form-input" value={mission.name}
            onChange={e => setMission({ ...mission, name: e.target.value })} />
        </div>
        <div className="form-group">
          <label className="form-label">Gun System (Indian Army)</label>
          <select className="form-select" value={mission.gunType}
            onChange={e => setMission({ ...mission, gunType: e.target.value })}>
            {Object.entries(
              Object.entries(INDIAN_ARMY_GUNS).reduce((acc, [k, v]) => {
                acc[v.group] = acc[v.group] || [];
                acc[v.group].push([k, v]);
                return acc;
              }, {})
            ).map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map(([k, v]) => (
                  <option key={k} value={k}>{v.icon} {v.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {mission.gunType === 'OTHER' && (
          <div className="form-group" style={{ padding: 10, border: '1px solid rgba(56,189,248,0.25)', borderRadius: 8, background: 'rgba(56,189,248,0.04)' }}>
            <div className="form-label" style={{ marginBottom: 8, fontSize: 11, color: '#38bdf8' }}>
              ⚙ Custom Platform Specs (sent to backend)
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                Name
                <input className="form-input"
                  value={mission.customGunName || ''}
                  placeholder="e.g. Self-built 130 mm"
                  onChange={(e) => setMission({ ...mission, customGunName: e.target.value })}
                  style={{ marginTop: 2, fontSize: 11 }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                Max Slope (°)
                <input className="form-input" type="number" min={1} max={25} step={0.5}
                  value={mission.customMaxSlope ?? 5}
                  onChange={(e) => setMission({ ...mission, customMaxSlope: parseFloat(e.target.value) || 5 })}
                  style={{ marginTop: 2, fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                Platform L (m)
                <input className="form-input" type="number" min={5} max={80} step={1}
                  value={mission.customPlatformLength ?? 25}
                  onChange={(e) => setMission({ ...mission, customPlatformLength: parseFloat(e.target.value) || 25 })}
                  style={{ marginTop: 2, fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                Platform W (m)
                <input className="form-input" type="number" min={5} max={80} step={1}
                  value={mission.customPlatformWidth ?? 25}
                  onChange={(e) => setMission({ ...mission, customPlatformWidth: parseFloat(e.target.value) || 25 })}
                  style={{ marginTop: 2, fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              </label>
              <label style={{ fontSize: 10, color: 'var(--text-secondary)', gridColumn: '1 / -1' }}>
                Separation between platforms (m)
                <input className="form-input" type="number" min={20} max={400} step={5}
                  value={mission.customSeparation ?? 150}
                  onChange={(e) => setMission({ ...mission, customSeparation: parseFloat(e.target.value) || 150 })}
                  style={{ marginTop: 2, fontSize: 11, fontFamily: 'var(--font-mono)' }} />
              </label>
            </div>
          </div>
        )}
        <div className="form-group">
          <label className="form-label">
            Number of Guns
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-secondary)' }}>(1–24)</span>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="form-input" type="number" min={1} max={24} step={1}
              value={mission.numGuns}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setMission({ ...mission, numGuns: Math.max(1, Math.min(24, n)) });
              }}
              style={{ width: 86, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
            />
            <div className="btn-group" style={{ flex: 1 }}>
              {[4, 6, 8, 12].map(n => (
                <button key={n}
                  className={`btn-option ${mission.numGuns === n ? 'active' : ''}`}
                  onClick={() => setMission({ ...mission, numGuns: n })}
                  title={`Quick-set ${n} guns`}
                >{n}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">
            Number of Batteries
            <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--text-secondary)' }}>(1–6)</span>
          </label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="form-input" type="number" min={1} max={6} step={1}
              value={mission.batteries}
              onChange={(e) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setMission({ ...mission, batteries: Math.max(1, Math.min(6, n)) });
              }}
              style={{ width: 86, textAlign: 'center', fontFamily: 'var(--font-mono)' }}
            />
            <div className="btn-group" style={{ flex: 1 }}>
              {[1, 2, 3, 4].map(n => (
                <button key={n}
                  className={`btn-option ${mission.batteries === n ? 'active' : ''}`}
                  onClick={() => setMission({ ...mission, batteries: n })}
                >{n}</button>
              ))}
            </div>
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-secondary)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
            ≈ {Math.max(1, Math.ceil((mission.numGuns || 1) / Math.max(mission.batteries || 1, 1)))} guns / battery
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Target Bearing</label>
          <CompassInput
            value={mission.targetBearing}
            onChange={(deg) => setMission((m) => ({ ...m, targetBearing: deg }))}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Day / Night</label>
          <div className="btn-group">
            {['Day', 'Night', 'Both'].map(v => (
              <button key={v}
                className={`btn-option ${mission.dayNight === v ? 'active' : ''}`}
                onClick={() => setMission({ ...mission, dayNight: v })}
              >{v}</button>
            ))}
          </div>
        </div>
        <div className="form-group">
          <label className="form-label">Season</label>
          <select className="form-select" value={mission.season}
            onChange={e => setMission({ ...mission, season: e.target.value })}>
            {['Summer', 'Monsoon', 'Post-Monsoon', 'Winter'].map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label className="form-label">Threat Level</label>
          <div className="btn-group">
            {['Low', 'Medium', 'High'].map(v => (
              <button key={v}
                className={`btn-option ${mission.threatLevel === v ? 'active' : ''}`}
                onClick={() => setMission({ ...mission, threatLevel: v })}
              >{v}</button>
            ))}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          {analysisState === 'analyzing' ? (
            <div className="progress-container">
              <button className="btn-primary analyzing" disabled>
                <motion.span
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  style={{ display: 'inline-flex' }}
                >
                  <Settings size={14} />
                </motion.span>
                &nbsp;Analyzing...
              </button>
              <div className="progress-text" style={{ marginTop: 10 }}>
                Mission analysis is running on the backend using the current district boundary or drawn AOI.
                Candidate results will open automatically when the backend returns the AOI analysis payload.
              </div>
            </div>
          ) : analysisState === 'done' ? (
            <motion.button
              className="btn-primary"
              style={{ background: 'linear-gradient(135deg, #22c55e, #16a34a)' }}
              onClick={() => setActiveTab('analysis')}
              whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            >
              <CheckCircle size={14} /> Analysis Complete — View Results
            </motion.button>
          ) : (
            <motion.button
              className="btn-primary"
              onClick={runAnalysis}
              disabled={liveLoading || !supportsMissionAnalysis}
              whileHover={{ scale: 1.02, boxShadow: '0 8px 28px rgba(14,165,233,0.5)' }}
              whileTap={{ scale: 0.97 }}
            >
              <Zap size={14} />
              {liveLoading
                ? 'SYNCING BACKEND...'
                : supportsMissionAnalysis
                  ? 'AI PRE-SCREEN'
                  : 'BACKEND INCOMPATIBLE'}
            </motion.button>
          )}
        </div>

        {analysisState === 'idle' && (
          <div className="sim-hint">
            <Info size={11} />
            <div>
              <strong>{customAOI ? 'Custom AOI Active' : isLive ? 'Live Backend Mode' : 'Offline Fallback Mode'}</strong>
              <p>
                {customAOI
                  ? 'Custom polygon defined. The backend will clip the suitability grid and rank candidate patches only inside this AOI. Route planning remains on-demand for the selected candidate.'
                  : isLive && supportsMissionAnalysis
                    ? `District ${activeDistrict} loaded. Top-50 baseline candidates from the model are visible on the map. Draw an AOI (optional) and click AI PRE-SCREEN to run mission-tailored analysis with your gun system, season and threat-level.`
                    : isLive
                      ? 'A legacy backend is reachable, but it does not expose AOI mission-analysis endpoints. Start `ps10_backend_service.py` instead of the old notebook server.'
                    : `Backend data is unavailable for ${activeDistrict}. ${liveError || 'Live mission analysis cannot run until the backend is reachable.'}`}
              </p>
            </div>
          </div>
        )}
        {analysisError && (
          <div className="sim-hint" style={{ marginTop: 12 }}>
            <AlertTriangle size={11} />
            <div>
              <strong>Analysis Error</strong>
              <p>{analysisError}</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════ */
/*  ANALYSIS SIDEBAR                          */
/*  Single source of truth for ESA WorldCover colours: src/lib/landcover.js  */
/* ═══════════════════════════════════════════ */
function AnalysisSidebar({
  candidates, selectedCandidate, setSelectedCandidate, setDetailCandidate,
  setActiveTab, terrainStats, district,
}) {
  const distribution = terrainStats?.classDistribution || [];
  const source = terrainStats?.landcoverSource || (distribution.length ? 'aoi' : 'unknown');
  const encoding = terrainStats?.landcoverEncoding || null;

  // Dev-only — logs the active source/encoding/distribution once per change.
  debugLandcover('AnalysisSidebar render', {
    district, landcoverSource: source, encoding,
    distribution: distribution.map(d => ({ name: d.name, value: d.value })),
  });

  // Merge backend distribution with the full 12-class ESA taxonomy so every
  // class is visible and ordered by percentage descending. Always uses
  // ESA_LANDCOVER_COLORS as the single colour source.
  const merged = mergeFullTaxonomy(distribution);

  return (
    <>
      <div className="sidebar-header">
        <h3><BarChart2 size={13} /> Terrain Analysis</h3>
      </div>
      <div className="sidebar-body">
        <TerrainPieChart terrainStats={{
          ...terrainStats,
          classDistribution: merged.filter(c => c.value > 0),
        }} />
        <div style={{ marginTop: 16 }}>
          <div className="form-label" style={{ marginBottom: 4, display: 'flex', justifyContent: 'space-between' }}>
            <span>Land Cover Distribution</span>
            <span style={{ fontSize: 9, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
              ESA WorldCover 2021
            </span>
          </div>
          <div style={{
            fontSize: 10, color: 'var(--text-secondary)', marginBottom: 8,
            fontFamily: 'var(--font-mono)', letterSpacing: 0.5,
          }}>
            Source: <span style={{ color: '#7dd3fc' }}>{sourceLabel(source)}</span>
            {encoding ? <span style={{ marginLeft: 6, opacity: 0.7 }}>· encoding {encoding}</span> : null}
          </div>
          {merged.map(c => (
            <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, fontSize: 11, opacity: c.value > 0 ? 1 : 0.45 }}>
              <div style={{
                width: 12, height: 12, borderRadius: 2, background: c.color, flexShrink: 0,
                border: (c.color === '#F0F0F0' || c.color === '#FFFF4C') ? '1px solid rgba(15,23,42,0.4)' : 'none',
              }} />
              <span style={{ flex: 1, color: 'var(--text-secondary)' }}>{c.name}</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: c.value > 0 ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: 600 }}>
                {c.value.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════ */
/*  TERRAIN PIE CHART                         */
/* ═══════════════════════════════════════════ */
function TerrainPieChart({ terrainStats }) {
  // Always resolve colour through landcoverColor() so the donut uses the same
  // ESA WorldCover hex set as the legend list and the map raster tile.
  const data = (terrainStats?.classDistribution || []).map((entry) => ({
    ...entry,
    color: landcoverColor(entry.name, entry.color),
  }));
  return (
    <div style={{ background: 'var(--bg-primary)', borderRadius: 12, border: '1px solid var(--border-default)', padding: 8 }}>
      <ResponsiveContainer width="100%" height={200}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%"
            innerRadius={50} outerRadius={80} paddingAngle={2} dataKey="value">
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 12 }}
            labelStyle={{ color: '#f1f5f9' }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  TERRAIN SUMMARY                           */
/* ═══════════════════════════════════════════ */
function TerrainSummary({ terrainStats }) {
  const items = [
    { value: terrainStats.greenAreas, label: 'Suitable', color: 'var(--green)', dim: 'var(--green-dim)', border: 'rgba(34,197,94,0.2)' },
    { value: terrainStats.amberAreas, label: 'Marginal', color: 'var(--amber)', dim: 'var(--amber-dim)', border: 'rgba(245,158,11,0.2)' },
    { value: terrainStats.redAreas,   label: 'Rejected', color: 'var(--red)',   dim: 'var(--red-dim)',   border: 'rgba(239,68,68,0.2)' },
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 14 }}>
      {items.map((item, i) => (
        <motion.div key={item.label}
          initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: i * 0.1, duration: 0.3 }}
          style={{ background: item.dim, borderRadius: 8, padding: '10px 8px', textAlign: 'center', border: `1px solid ${item.border}` }}
        >
          <div style={{ fontSize: 20, fontWeight: 800, color: item.color, fontFamily: 'var(--font-mono)' }}>
            <AnimatedCounter to={item.value} />
          </div>
          <div style={{ fontSize: 9, fontWeight: 700, color: item.color, textTransform: 'uppercase', letterSpacing: 0.5 }}>{item.label}</div>
        </motion.div>
      ))}
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  CANDIDATE CARD                            */
/* ═══════════════════════════════════════════ */
function CandidateCard({ candidate: c, rank, isSelected, onClick, onDetail, onRoute, onDrone }) {
  const area = candidateAreaMetrics(c);
  const gunFit = candidateGunFit(c);
  return (
    <div className={`candidate-card rating-${c.rating} ${isSelected ? 'selected' : ''}`} onClick={onClick}>
      <div className="card-top">
        <div>
          <div className="card-rank">Rank #{rank}</div>
          <div className="card-name">Area {c.name}</div>
        </div>
        <ScoreRing score={c.totalScore} rating={c.rating} size={64} />
      </div>
      <div className="card-stats">
        <div className="stat-item">
          <span className="stat-label">Slope:</span>
          <span className="stat-value">{c.terrain.avgSlope}°</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Elev:</span>
          <span className="stat-value">{c.elevation}m</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Area:</span>
          <span className="stat-value">{area.length}×{area.width}m</span>
        </div>
        <div className="stat-item">
          <span className="stat-label">Guns:</span>
          <span className="stat-value">{gunFit.estimated_gun_capacity ?? c.maxGunsFit} fit</span>
        </div>
      </div>
      <div className="card-tags">
        {c.strengths.slice(0, 2).map((s, i) => (
          <span key={i} className="tag tag-strength">
            <CheckCircle size={9} /> {s.slice(0, 32)}{s.length > 32 ? '…' : ''}
          </span>
        ))}
        {c.rejections.length > 0 && (
          <span className="tag tag-rejection">
            <XCircle size={9} /> {c.rejections[0].slice(0, 32)}…
          </span>
        )}
      </div>
      <div className="card-actions">
        <button className="btn-secondary btn-sm" onClick={e => { e.stopPropagation(); onDetail(); }}>
          <BarChart2 size={11} /> Detail
        </button>
        <button className="btn-secondary btn-sm" onClick={e => { e.stopPropagation(); onRoute(); }}>
          <Navigation size={11} /> Route
        </button>
        <button className="btn-secondary btn-sm" onClick={e => { e.stopPropagation(); onDrone?.(); }}>
          <Plane size={11} /> Drone Recce
        </button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  DETAIL PANEL                              */
/* ═══════════════════════════════════════════ */
function DetailPanel({ candidate: c, onClose, setActiveTab, setSelectedCandidate, onPlanRoute }) {
  if (!c) return null;
  const area = candidateAreaMetrics(c);
  const gunFit = candidateGunFit(c);
  const canopyDensity = candidateCanopyDensity(c);
  const canopyCover = canopyCoverLabel(canopyDensity);
  const concealmentQuality = concealmentQualityLabel(c);
  const radarData = Object.entries(c.scores).map(([key, val]) => ({
    subject: SCORING_WEIGHTS[key]?.label || key,
    score: val,
    fullMark: 100,
  }));

  return (
    <motion.div className="detail-panel"
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="detail-header">
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Detailed Analysis</div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
            Area {c.name}
            <span style={{ marginLeft: 10, color: c.rating === 'GREEN' ? 'var(--green)' : c.rating === 'AMBER' ? 'var(--amber)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
              {c.totalScore}/100
            </span>
          </div>
        </div>
        <button className="detail-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="detail-body">
        <div className="radar-container">
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(71,85,105,0.3)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 9 }} />
              <Radar name="Score" dataKey="score" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="detail-section">
          <div className="detail-section-title"><CheckCircle size={11} /> Strengths</div>
          {c.strengths.map((s, i) => (
            <div key={i} style={{ fontSize: 12, color: 'var(--green)', marginBottom: 4, paddingLeft: 8 }}>• {s}</div>
          ))}
        </div>

        {c.weaknesses.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title"><AlertTriangle size={11} /> Warnings</div>
            {c.weaknesses.map((w, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 4, paddingLeft: 8 }}>• {w}</div>
            ))}
          </div>
        )}

        {c.rejections.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title"><XCircle size={11} /> Hard Rejections</div>
            {c.rejections.map((r, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--red)', marginBottom: 4, paddingLeft: 8, fontWeight: 600 }}>• {r}</div>
            ))}
          </div>
        )}

        <div className="detail-section">
          <div className="detail-section-title"><MapPin size={11} /> Terrain Parameters</div>
          <table className="param-table">
            <tbody>
              <tr><td>Grid Reference</td><td>{c.gridRef}</td></tr>
              <tr><td>Elevation</td><td>{c.elevation} m ASL</td></tr>
              <tr><td>Average Slope</td><td>{c.terrain.avgSlope}°</td></tr>
              <tr><td>Max Slope</td><td>{c.terrain.maxSlope}°</td></tr>
              <tr><td>Soil Type</td><td>{c.terrain.soilType}</td></tr>
              <tr><td>Bearing Capacity</td><td>{c.terrain.bearingKpa} kPa</td></tr>
              <tr><td>Available Area</td><td>{area.length} x {area.width} m ({area.availableAreaKm2.toFixed(3)} km2 local patch)</td></tr>
              <tr><td>Analysis Radius</td><td>{area.analysisRadiusM ?? 'N/A'} m ({area.extentType || 'candidate_buffer'})</td></tr>
              <tr><td>Guns Fit</td><td>{gunFit.estimated_gun_capacity ?? c.maxGunsFit} theoretical - {gunFit.guns_fit_status || 'N/A'}</td></tr>
              <tr><td>Required Guns</td><td>{gunFit.required_guns ?? 'N/A'} total â€¢ {gunFit.guns_per_battery ?? 'N/A'} per battery</td></tr>
              <tr><td>Footprint / Gun</td><td>{gunFit.footprint_per_gun_m2 ?? 'N/A'} mÂ²</td></tr>
              <tr><td>Cover Sides</td><td>{c.terrain.coverSides} / 4</td></tr>
              <tr><td>Canopy Density</td><td>{canopyDensity}%</td></tr>
              <tr><td>Canopy Clearance</td><td>{c.terrain.canopyClearancePercent ?? 'N/A'}%</td></tr>
              <tr><td>Nearest Road</td><td>{c.access.nearestRoadDist} m ({c.access.roadType})</td></tr>
              <tr><td>Road Width</td><td>{c.access.roadWidth} m</td></tr>
              <tr><td>Route Max Gradient</td><td>{c.access.routeMaxSlope}°</td></tr>
              <tr><td>Civilian Structures</td><td>{c.threats.civilianStructures}</td></tr>
              <tr><td>Nearest Civilian</td><td>{c.threats.nearestCivilianDist} m</td></tr>
              <tr><td>TPI Value</td><td>{c.threats.tpiValue}</td></tr>
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <motion.button className="btn-primary" style={{ fontSize: 12, padding: 10 }}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => {
              setSelectedCandidate(c.id);
              onPlanRoute?.(c);
              setActiveTab('routes');
              onClose();
            }}
          >
            <Navigation size={12} /> Plan Route
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}

function DetailPanelOperational({ candidate: c, onClose, setActiveTab, setSelectedCandidate, onPlanRoute, onAssignDrone }) {
  if (!c) return null;
  const area = candidateAreaMetrics(c);
  const gunFit = candidateGunFit(c);
  const canopyDensity = candidateCanopyDensity(c);
  const canopyCover = canopyCoverLabel(canopyDensity);
  const concealmentQuality = concealmentQualityLabel(c);
  const radarData = Object.entries(c.scores).map(([key, val]) => ({
    subject: SCORING_WEIGHTS[key]?.label || key,
    score: val,
    fullMark: 100,
  }));

  return (
    <motion.div className="detail-panel"
      initial={{ x: '100%', opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: '100%', opacity: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      <div className="detail-header">
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
            Detailed Analysis
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, marginTop: 2 }}>
            Area {c.name}
            <span style={{ marginLeft: 10, color: c.rating === 'GREEN' ? 'var(--green)' : c.rating === 'AMBER' ? 'var(--amber)' : 'var(--red)', fontFamily: 'var(--font-mono)' }}>
              {c.totalScore}/100
            </span>
          </div>
        </div>
        <button className="detail-close" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div className="detail-body">
        <div className="radar-container">
          <ResponsiveContainer width="100%" height={260}>
            <RadarChart data={radarData}>
              <PolarGrid stroke="rgba(71,85,105,0.3)" />
              <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 10 }} />
              <PolarRadiusAxis angle={90} domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 9 }} />
              <Radar name="Score" dataKey="score" stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.2} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        <div className="detail-section">
          <div className="detail-section-title"><CheckCircle size={11} /> Strengths</div>
          {c.strengths.map((strength, index) => (
            <div key={index} style={{ fontSize: 12, color: 'var(--green)', marginBottom: 4, paddingLeft: 8 }}>• {strength}</div>
          ))}
        </div>

        {c.weaknesses.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title"><AlertTriangle size={11} /> Warnings</div>
            {c.weaknesses.map((warning, index) => (
              <div key={index} style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 4, paddingLeft: 8 }}>• {warning}</div>
            ))}
          </div>
        )}

        {c.rejections.length > 0 && (
          <div className="detail-section">
            <div className="detail-section-title"><XCircle size={11} /> Hard Rejections</div>
            {c.rejections.map((rejection, index) => (
              <div key={index} style={{ fontSize: 12, color: 'var(--red)', marginBottom: 4, paddingLeft: 8, fontWeight: 600 }}>• {rejection}</div>
            ))}
          </div>
        )}

        <div className="detail-section">
          <div className="detail-section-title"><MapPin size={11} /> Terrain Parameters</div>
          <table className="param-table">
            <tbody>
              <tr><td>Grid Reference</td><td>{c.gridRef}</td></tr>
              <tr><td>Elevation</td><td>{c.elevation} m ASL</td></tr>
              <tr><td>Average Slope</td><td>{c.terrain.avgSlope} deg</td></tr>
              <tr><td>Max Slope</td><td>{c.terrain.maxSlope} deg</td></tr>
              <tr><td>Soil Type</td><td>{c.terrain.soilType}</td></tr>
              <tr><td>Bearing Capacity</td><td>{c.terrain.bearingKpa} kPa</td></tr>
              <tr><td>Available Area</td><td>{area.length} x {area.width} m ({area.availableAreaKm2.toFixed(3)} km2 local patch)</td></tr>
              <tr><td>Analysis Radius</td><td>{area.analysisRadiusM ?? 'N/A'} m ({area.extentType || 'candidate_buffer'})</td></tr>
              <tr><td>Guns Fit</td><td>{gunFit.estimated_gun_capacity ?? c.maxGunsFit} theoretical - {gunFit.guns_fit_status || 'N/A'}</td></tr>
              <tr><td>Required Guns</td><td>{gunFit.required_guns ?? 'N/A'} total / {gunFit.guns_per_battery ?? 'N/A'} per battery</td></tr>
              <tr><td>Footprint / Gun</td><td>{gunFit.footprint_per_gun_m2 ?? 'N/A'} sq m</td></tr>
              <tr><td>Canopy Cover</td><td>{canopyCover}</td></tr>
              <tr><td>Canopy Clearance</td><td>{c.terrain.canopyClearancePercent ?? 'N/A'}%</td></tr>
              <tr><td>Concealment Quality</td><td>{concealmentQuality}</td></tr>
              <tr><td>Nearest Road</td><td>{c.access.nearestRoadDist} m ({c.access.roadType})</td></tr>
              <tr><td>Road Width</td><td>{c.access.roadWidth} m</td></tr>
              <tr><td>Local Max Slope</td><td>{c.access.routeMaxSlope} deg</td></tr>
              <tr><td>Civilian Structures</td><td>{c.threats.civilianStructures}</td></tr>
              <tr><td>Nearest Civilian</td><td>{c.threats.nearestCivilianDist} m</td></tr>
              <tr><td>TPI Value</td><td>{c.threats.tpiValue}</td></tr>
            </tbody>
          </table>
        </div>

        {SHOW_DEBUG_METRICS && (
          <div className="detail-section">
            <div className="detail-section-title"><Cpu size={11} /> Debug Metrics</div>
            <table className="param-table">
              <tbody>
                <tr><td>Canopy Density</td><td>{canopyDensity}%</td></tr>
                <tr><td>Cover Sides</td><td>{c.terrain.coverSides} / 4</td></tr>
                <tr><td>Tree Cover Share</td><td>{candidateTreeCoverShare(c)}%</td></tr>
              </tbody>
            </table>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <motion.button className="btn-primary" style={{ fontSize: 12, padding: 10 }}
            whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
            onClick={() => {
              setSelectedCandidate(c.id);
              onPlanRoute?.(c);
              setActiveTab('routes');
              onClose();
            }}
          >
            <Navigation size={12} /> Plan Route
          </motion.button>
          <button
            className="btn-secondary"
            style={{ fontSize: 12, padding: 10 }}
            onClick={() => {
              setSelectedCandidate(c.id);
              onAssignDrone?.(c);
              setActiveTab('routes');
              onClose();
            }}
          >
            <Plane size={12} /> Drone Recce
          </button>
        </div>
      </div>
    </motion.div>
  );
}

/* ═══════════════════════════════════════════ */
/*  ROUTE VIEW                                */
/* ═══════════════════════════════════════════ */
function RouteView({ candidate, route, loading, error }) {
  if (loading) {
    return (
      <div className="empty-state">
        <motion.div className="empty-icon"
          animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
        >
          <Navigation size={48} />
        </motion.div>
        <div className="empty-title">Calculating Route</div>
        <div className="empty-description">
          Finding the nearest major-road access point and solving the road-network path for the selected candidate.
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="empty-state">
        <motion.div className="empty-icon"
          animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <AlertTriangle size={48} />
        </motion.div>
        <div className="empty-title">Route Analysis Failed</div>
        <div className="empty-description">{error}</div>
      </div>
    );
  }
  if (!route || !candidate) {
    return (
      <div className="empty-state">
        <motion.div className="empty-icon"
          animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Navigation size={48} />
        </motion.div>
        <div className="empty-title">{candidate ? 'Route Not Available' : 'Select a Gun Area'}</div>
        <div className="empty-description">
          {candidate
            ? 'Use Plan Route on a selected candidate to compute a road-network route from the nearest highway or major-road access point.'
            : 'Choose a candidate from the Analysis tab to inspect route outputs when available.'}
        </div>
      </div>
    );
  }
  const metrics = route.metrics || {};
  const profile = metrics.elevation_profile || [];
  return (
    <div className="fade-in">
      <div className="route-card">
        <h4><Navigation size={13} /> Route Analysis</h4>
        <div className="route-stat-grid">
          {[
            { label: 'Start Source', value: route.auto_start?.properties?.source || 'Nearest highway' },
            { label: 'Start Road', value: metrics.start_road_name || 'Unnamed road' },
            { label: 'Road Class', value: metrics.start_road_class || 'Unknown' },
            { label: 'Feasibility', value: metrics.feasibility || 'Unknown' },
          ].map((s, i) => (
            <motion.div key={s.label} className="route-stat"
              initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.25 }}
            >
              <div className="route-stat-label">{s.label}</div>
              <div className="route-stat-value" style={s.color ? { color: s.color } : {}}>{s.value}</div>
            </motion.div>
          ))}
        </div>
      </div>

      <div className="route-card">
        <h4><Target size={13} /> Metrics</h4>
        <table className="param-table">
          <tbody>
            <tr><td>Total Distance</td><td>{((metrics.total_distance_m || 0) / 1000).toFixed(2)} km</td></tr>
            <tr><td>Road Distance</td><td>{((metrics.road_distance_m || 0) / 1000).toFixed(2)} km</td></tr>
            <tr><td>Final Access</td><td>{metrics.offroad_distance_m ?? 0} m</td></tr>
            <tr><td>Estimated Time</td><td>{metrics.estimated_time_min ?? 'N/A'} min</td></tr>
            <tr><td>Average Gradient</td><td>{metrics.avg_gradient_deg == null ? 'Not available' : `${metrics.avg_gradient_deg}°`}</td></tr>
            <tr><td>Max Gradient</td><td>{metrics.max_gradient_deg == null ? 'Not available' : `${metrics.max_gradient_deg}°`}</td></tr>
            <tr><td>Nearest Road Distance</td><td>{metrics.nearest_road_distance_m ?? 0} m</td></tr>
            <tr><td>Bridges / Tunnels</td><td>{metrics.bridges ?? 0} / {metrics.tunnels ?? 0}</td></tr>
          </tbody>
        </table>
      </div>

      {profile.length > 1 && (
        <div className="route-card">
          <h4><TrendingUp size={13} /> Elevation Profile</h4>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={profile}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(71,85,105,0.2)" />
              <XAxis dataKey="dist" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${(v / 1000).toFixed(1)}km`} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}m`} />
              <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} />
              <Area type="monotone" dataKey="elev" stroke="#38bdf8" fill="rgba(56,189,248,0.15)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="route-card">
        <h4><MapPin size={13} /> Warnings</h4>
        {metrics.warnings?.length ? (
          <ul className="waypoint-list">
            {metrics.warnings.map((warning, i) => (
              <li key={i} className="waypoint-item">
                <div className="waypoint-name">Warning {i + 1}</div>
                <div className="waypoint-instruction">{warning}</div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-description" style={{ minHeight: 0 }}>No backend warnings were reported for this route.</div>
        )}
      </div>
    </div>
  );
}

function RouteViewEnhanced({
  candidate,
  route,
  loading,
  error,
  onAssignDrone,
  droneMission,
  droneLoading,
  droneError,
  droneDeviceIp,
  setDroneDeviceIp,
  droneSendState,
  droneSendMessage,
  onExportGeoJson,
  onExportKml,
  onSendMission,
}) {
  if (loading) {
    return (
      <div className="empty-state">
        <motion.div className="empty-icon"
          animate={{ rotate: 360 }} transition={{ duration: 1.4, repeat: Infinity, ease: 'linear' }}
        >
          <Navigation size={48} />
        </motion.div>
        <div className="empty-title">Calculating Route</div>
        <div className="empty-description">
          Finding the nearest major-road access point and solving the road-network path for the selected candidate.
        </div>
      </div>
    );
  }

  if (!candidate && !droneMission) {
    return (
      <div className="empty-state">
        <motion.div className="empty-icon"
          animate={{ y: [0, -6, 0] }} transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Navigation size={48} />
        </motion.div>
        <div className="empty-title">Select a Gun Area</div>
        <div className="empty-description">
          Choose a candidate from the Analysis tab to inspect route outputs or assign a drone recce mission.
        </div>
      </div>
    );
  }

  const metrics = route?.metrics || {};
  const profile = metrics.elevation_profile || [];
  const terrainAnalysisMode = metrics.terrain_analysis_mode || (metrics.terrain_penalty_applied ? 'road_cost_and_profile' : 'not_available');
  const terrainModeLabel =
    terrainAnalysisMode === 'road_cost_and_profile'
      ? 'Applied in route costing'
      : terrainAnalysisMode === 'profile_only'
        ? 'Computed from DEM profile'
        : 'Not available';
  const roadClassMix = Object.entries(metrics.road_classes || {})
    .sort((a, b) => b[1] - a[1])
    .map(([roadClass, length]) => ({
      roadClass,
      lengthKm: (Number(length || 0) / 1000).toFixed(2),
    }));
  const filteredWarnings = (metrics.warnings || []).filter((warning) => {
    if (!warning) return false;
    if (
      warning === 'DEM not available; slope-aware routing skipped.'
      && (metrics.slope_analysis_available || metrics.avg_gradient_deg != null || metrics.max_gradient_deg != null)
    ) {
      return false;
    }
    return true;
  });
  const droneWaypoints = droneMission?.geojson?.features?.filter((feature) => feature?.geometry?.type === 'Point') || [];
  const droneStatus = droneMission ? `Assigned / ${droneVerificationLabel(droneMission)}` : 'Not Assigned';

  return (
    <div className="fade-in">
      {error ? (
        <div className="route-card">
          <h4><AlertTriangle size={13} /> Route Analysis Failed</h4>
          <div className="empty-description" style={{ minHeight: 0 }}>{error}</div>
        </div>
      ) : null}

      {!route ? (
        <div className="route-card">
          <h4><Navigation size={13} /> Route Analysis</h4>
          <div className="empty-description" style={{ minHeight: 0, marginBottom: 12 }}>
            Use Plan Route on the selected candidate to compute a road-network approach from the nearest highway or major-road access point.
          </div>
          {candidate ? (
            <button className="btn-secondary" onClick={() => onAssignDrone?.(candidate)}>
              <Plane size={12} /> Assign Drone Recce
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="route-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <h4><Navigation size={13} /> Route Analysis</h4>
                <div className="route-stat-grid">
                  {[
                    { label: 'Start Source', value: route.auto_start?.properties?.source || 'Nearest highway' },
                    { label: 'Start Road', value: metrics.start_road_name || 'Unnamed road' },
                    { label: 'Road Class', value: metrics.start_road_class || 'Unknown' },
                    { label: 'Feasibility', value: metrics.feasibility || 'Unknown' },
                  ].map((stat, index) => (
                    <motion.div key={stat.label} className="route-stat"
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.08, duration: 0.25 }}
                    >
                      <div className="route-stat-label">{stat.label}</div>
                      <div className="route-stat-value">{stat.value}</div>
                    </motion.div>
                  ))}
                </div>
              </div>
              {candidate ? (
                <button className="btn-secondary" onClick={() => onAssignDrone?.(candidate)}>
                  <Plane size={12} /> {droneMission ? 'Refresh Drone Recce' : 'Assign Drone Recce'}
                </button>
              ) : null}
            </div>
          </div>

          <div className="route-card">
            <h4><Target size={13} /> Metrics</h4>
            <table className="param-table">
              <tbody>
                <tr><td>Total Distance</td><td>{formatDistanceKm(metrics.total_distance_m)}</td></tr>
                <tr><td>Road Distance</td><td>{formatDistanceKm(metrics.road_distance_m)}</td></tr>
                <tr><td>Final Access</td><td>{metrics.offroad_distance_m ?? 0} m</td></tr>
                <tr><td>Estimated Time</td><td>{metrics.estimated_time_min ?? 'N/A'} min</td></tr>
                <tr><td>Average Gradient</td><td>{metrics.avg_gradient_deg == null ? 'Not available' : `${metrics.avg_gradient_deg} deg`}</td></tr>
                <tr><td>Max Gradient</td><td>{metrics.max_gradient_deg == null ? 'Not available' : `${metrics.max_gradient_deg} deg`}</td></tr>
                <tr><td>Slope-Aware Analysis</td><td>{terrainModeLabel}</td></tr>
                <tr><td>Nearest Road Distance</td><td>{metrics.nearest_road_distance_m ?? 0} m</td></tr>
                <tr><td>Bridges / Tunnels</td><td>{metrics.bridges ?? 0} / {metrics.tunnels ?? 0}</td></tr>
                <tr><td>Settlement Crossings</td><td>{metrics.settlement_hits ?? 0}</td></tr>
              </tbody>
            </table>
          </div>

          <div className="route-card">
            <h4><Layers size={13} /> Road Composition</h4>
            {roadClassMix.length ? (
              <table className="param-table">
                <tbody>
                  {roadClassMix.map(({ roadClass, lengthKm }) => (
                    <tr key={roadClass}>
                      <td style={{ textTransform: 'capitalize' }}>{roadClass.replace(/_/g, ' ')}</td>
                      <td>{lengthKm} km</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty-description" style={{ minHeight: 0 }}>Road-class composition is not available for this route.</div>
            )}
          </div>

          <div className="route-card">
            <h4><Shield size={13} /> Final Access Screening</h4>
            <table className="param-table">
              <tbody>
                <tr><td>Off-road Distance</td><td>{metrics.offroad_access?.distance_m ?? metrics.offroad_distance_m ?? 0} m</td></tr>
                <tr><td>Off-road Avg Slope</td><td>{metrics.offroad_access?.avg_slope_deg == null ? 'Not available' : `${metrics.offroad_access.avg_slope_deg} deg`}</td></tr>
                <tr><td>Off-road Max Slope</td><td>{metrics.offroad_access?.max_slope_deg == null ? 'Not available' : `${metrics.offroad_access.max_slope_deg} deg`}</td></tr>
                <tr><td>Water Crossing</td><td>{metrics.offroad_access?.water_crossing ? 'Detected' : 'No'}</td></tr>
                <tr><td>Built-up Crossing</td><td>{metrics.offroad_access?.built_up_crossing ? 'Detected' : 'No'}</td></tr>
                <tr><td>Canopy Obstruction</td><td>{metrics.offroad_access?.canopy_obstruction == null ? 'Not available' : metrics.offroad_access.canopy_obstruction}</td></tr>
              </tbody>
            </table>
          </div>

          {profile.length > 1 && (
            <div className="route-card">
              <h4><TrendingUp size={13} /> Elevation Profile</h4>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={profile}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(71,85,105,0.2)" />
                  <XAxis dataKey="dist" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(value) => `${(value / 1000).toFixed(1)}km`} />
                  <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={(value) => `${value}m`} />
                  <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8, fontSize: 11 }} />
                  <Area type="monotone" dataKey="elev" stroke="#38bdf8" fill="rgba(56,189,248,0.15)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="route-card">
            <h4><MapPin size={13} /> Warnings</h4>
            {filteredWarnings.length ? (
              <ul className="waypoint-list">
                {filteredWarnings.map((warning, index) => (
                  <li key={index} className="waypoint-item">
                    <div className="waypoint-name">Warning {index + 1}</div>
                    <div className="waypoint-instruction">{warning}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-description" style={{ minHeight: 0 }}>No backend warnings were reported for this route.</div>
            )}
          </div>
        </>
      )}

      <div className="route-card">
        <h4><Plane size={13} /> Drone Recce Mission</h4>
        {droneLoading ? (
          <div className="empty-description" style={{ minHeight: 0 }}>Generating logical survey waypoints from the selected route and candidate area.</div>
        ) : null}
        {droneError ? (
          <div className="empty-description" style={{ minHeight: 0, color: 'var(--amber)', marginBottom: 12 }}>{droneError}</div>
        ) : null}

        {droneMission ? (
          <>
            <table className="param-table">
              <tbody>
                <tr><td>Status</td><td>{droneStatus}</td></tr>
                <tr><td>Waypoints</td><td>{droneMission.waypoint_count ?? droneWaypoints.length}</td></tr>
                <tr><td>Survey Distance</td><td>{formatDistanceKm(droneMission.survey_distance_m)}</td></tr>
                <tr><td>Estimated Flight Time</td><td>{droneMission.estimated_flight_time_min ?? 'N/A'} min</td></tr>
              </tbody>
            </table>

            <div style={{ marginTop: 14 }}>
              <div className="detail-section-title"><MapPin size={11} /> Waypoint Tasks</div>
              <ul className="waypoint-list">
                {droneWaypoints.slice(0, 8).map((feature) => (
                  <li key={feature.properties?.id} className="waypoint-item">
                    <div className="waypoint-name">{feature.properties?.id} · {feature.properties?.name}</div>
                    <div className="waypoint-instruction">{feature.properties?.task}</div>
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              <button className="btn-secondary" onClick={() => onExportGeoJson?.(droneMission, candidate)}>
                <Download size={12} /> Export GeoJSON
              </button>
              <button className="btn-secondary" onClick={() => onExportKml?.(droneMission, candidate)}>
                <Download size={12} /> Export KML
              </button>
            </div>

            <div style={{ marginTop: 14, display: 'grid', gap: 8 }}>
              <input
                className="form-input"
                placeholder="Device IP or http://host:port"
                value={droneDeviceIp}
                onChange={(event) => setDroneDeviceIp?.(event.target.value)}
              />
              <button
                className="btn-primary"
                onClick={() => onSendMission?.(droneMission)}
                disabled={droneSendState === 'loading'}
              >
                <Share2 size={12} /> {droneSendState === 'loading' ? 'Sending Mission...' : 'Send to IP Device'}
              </button>
              {droneSendMessage ? (
                <div
                  className="empty-description"
                  style={{
                    minHeight: 0,
                    color: droneSendState === 'done' ? 'var(--green)' : droneSendState === 'error' ? 'var(--amber)' : 'var(--text-muted)',
                  }}
                >
                  {droneSendMessage}
                </div>
              ) : null}
            </div>
          </>
        ) : (
          <div className="empty-description" style={{ minHeight: 0 }}>
            {candidate
              ? 'Assign Drone Recce to generate a practical waypoint mission for route verification, final access screening, and candidate-area observation.'
              : 'Select a candidate to create a drone recce mission.'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  COMMANDER DASHBOARD                       */
/* ═══════════════════════════════════════════ */
const candidateStatusLabel = (candidate) => {
  if (!candidate) return 'Avoid';
  if (candidate.rating === 'GREEN') return 'Recommended';
  if (candidate.rating === 'AMBER') return 'Use with Caution';
  return 'Avoid';
};

const bestCandidateForMission = (candidates) => (
  [...(candidates || [])].sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0))[0] || null
);

const alternateCandidateForMission = (candidates, primaryCandidate) => (
  [...(candidates || [])]
    .filter((candidate) => !primaryCandidate || candidate.id !== primaryCandidate.id)
    .sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0))[0] || null
);

const bestPlannedRoute = (routes, candidate) => {
  if (!routes) return null;
  if (candidate && routes[candidate.id]) return routes[candidate.id];
  const availableRoutes = Object.values(routes).filter(Boolean);
  if (!availableRoutes.length) return null;
  return [...availableRoutes].sort((a, b) => Number(a?.metrics?.estimated_time_min || 99999) - Number(b?.metrics?.estimated_time_min || 99999))[0];
};

const routeMainRisk = (route) => {
  if (!route?.metrics) return 'Route analysis not planned';
  const metrics = route.metrics;
  if ((metrics.offroad_distance_m || 0) >= 500) return 'Long final off-road access';
  if ((metrics.max_gradient_deg || 0) >= 8) return 'High route gradient';
  if (metrics.offroad_access?.water_crossing) return 'Water crossing on final access';
  if (metrics.offroad_access?.built_up_crossing) return 'Built-up crossing on final access';
  if ((metrics.nearest_road_distance_m || 0) >= 250) return 'Candidate lies away from road edge';
  return 'No major route constraint detected';
};

const buildCriticalRisks = (candidate, route) => {
  const risks = [];
  if (!candidate) return risks;
  const gunFit = candidateGunFit(candidate);
  if ((gunFit.guns_fit_status || '').toLowerCase() === 'fail' || Number(gunFit.estimated_gun_capacity || 0) < Number(gunFit.required_guns || 0)) {
    risks.push('Capacity insufficient for full deployment');
  }
  if ((candidate.threats?.nearestCivilianDist || 9999) < 500) {
    risks.push('Civilian proximity requires caution');
  }
  if ((candidate.access?.nearestRoadDist || 0) > 1200) {
    risks.push('Road access is distant');
  }
  if (route?.metrics) {
    if ((route.metrics.max_gradient_deg || 0) >= 8) risks.push('High route gradient');
    if ((route.metrics.offroad_distance_m || 0) >= 500) risks.push('Long final access');
    if (route.metrics.offroad_access?.water_crossing || route.metrics.offroad_access?.built_up_crossing) {
      risks.push('Access corridor has crossing constraints');
    }
  }
  return [...new Set(risks)].slice(0, 3);
};

const candidateAllocationStatus = (candidate) => {
  if (!candidate) return 'Unallocated';
  const gunFit = candidateGunFit(candidate);
  if ((gunFit.guns_fit_status || '').toLowerCase() === 'fail') return 'Capacity Insufficient';
  if (candidate.rating === 'RED') return 'Not Recommended';
  return 'Allocated';
};

const candidateCapacityLabel = (candidate) => {
  const gunFit = candidateGunFit(candidate);
  if (!candidate) return '--';
  const capacity = gunFit.estimated_gun_capacity ?? candidate.maxGunsFit ?? 0;
  return `${capacity} guns`;
};

const simpleRiskLevel = (score) => {
  if (score >= 70) return 'Low';
  if (score >= 45) return 'Medium';
  return 'High';
};

const terrainRiskLevel = (candidate) => {
  if (!candidate) return 'High';
  const slopeScore = 100 - Math.min(100, Number(candidate.terrain?.avgSlope || 0) * 12);
  return simpleRiskLevel(slopeScore);
};

const accessRiskLevel = (candidate, route) => {
  if (route?.metrics) {
    const penalty = Math.max(Number(route.metrics.offroad_distance_m || 0) / 10, Number(route.metrics.max_gradient_deg || 0) * 6);
    return simpleRiskLevel(100 - penalty);
  }
  return simpleRiskLevel(100 - Math.min(100, Number(candidate?.access?.nearestRoadDist || 0) / 12));
};

const civilianRiskLevel = (candidate) => simpleRiskLevel(Math.min(100, Number(candidate?.threats?.nearestCivilianDist || 0) / 12));

const waterRiskLevel = (candidate, route) => {
  if (route?.metrics?.offroad_access?.water_crossing) return 'High';
  const drainageScore = Number(candidate?.scores?.drainage || 0);
  return simpleRiskLevel(drainageScore);
};

const routeRiskLevel = (route) => {
  if (!route?.metrics) return 'High';
  const feasibility = String(route.metrics.feasibility || '').toLowerCase();
  if (feasibility === 'excellent' || feasibility === 'good') return 'Low';
  if (feasibility === 'moderate') return 'Medium';
  return 'High';
};

const printableReportWindow = (container, title) => {
  if (!container) return;
  const styles = Array.from(document.querySelectorAll('style, link[rel=\"stylesheet\"]'))
    .map((node) => node.outerHTML)
    .join('\n');
  const markup = container.outerHTML;
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentWindow?.document;
  if (!frameDoc || !iframe.contentWindow) {
    iframe.remove();
    return;
  }

  frameDoc.open();
  frameDoc.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <base href="${document.baseURI}" />
    ${styles}
    <style>
      html, body { margin: 0; padding: 0; background: #ffffff; color: #111827; }
      body { padding: 24px; font-family: Inter, system-ui, sans-serif; }
      body, body * {
        visibility: visible !important;
        color: #111827 !important;
        -webkit-text-fill-color: #111827 !important;
        text-shadow: none !important;
        box-shadow: none !important;
      }
      * {
        animation: none !important;
        transition: none !important;
        filter: none !important;
      }
      .report-actions { display: none !important; }
      .report-container {
        max-width: 1024px !important;
        margin: 0 auto !important;
        background: #ffffff !important;
        color: #111827 !important;
        box-shadow: none !important;
        border: 1px solid #cbd5e1 !important;
        opacity: 1 !important;
        transform: none !important;
      }
      .report-header,
      .report-section,
      .report-section *,
      .report-section p,
      .report-section li,
      .report-title,
      .report-meta,
      .report-label,
      .param-table,
      .allocation-table,
      .allocation-table th,
      .allocation-table td {
        color: #111827 !important;
        background: transparent !important;
      }
      .report-classification {
        color: #0f172a !important;
        animation: none !important;
      }
      .report-section h4 {
        color: #0f172a !important;
      }
      .allocation-table,
      .param-table {
        width: 100% !important;
        border-collapse: collapse !important;
      }
      .allocation-table th,
      .allocation-table td,
      .param-table th,
      .param-table td {
        border: 1px solid #cbd5e1 !important;
        padding: 6px 8px !important;
        background: #ffffff !important;
      }
      .tag,
      .dash-card,
      .route-card {
        background: transparent !important;
        border-color: #cbd5e1 !important;
      }
      svg, canvas {
        display: none !important;
      }
      @page { size: A4; margin: 12mm; }
      @media print {
        html, body { background: #ffffff !important; }
        body { padding: 0 !important; }
        .report-container { border: none !important; }
      }
    </style>
  </head>
  <body>${markup}</body>
</html>`);
  frameDoc.close();

  const triggerPrint = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 1500);
  };

  iframe.onload = () => {
    window.setTimeout(triggerPrint, 700);
  };

  // Fallback for browsers that do not fire iframe load after document.write reliably.
  window.setTimeout(triggerPrint, 1200);
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const printStandaloneHtml = (title, bodyMarkup) => {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  iframe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(iframe);

  const frameDoc = iframe.contentWindow?.document;
  if (!frameDoc || !iframe.contentWindow) {
    iframe.remove();
    return;
  }

  frameDoc.open();
  frameDoc.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <style>
      @page { size: A4; margin: 12mm; }
      html, body { margin: 0; padding: 0; background: #fff; color: #111827; }
      body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; padding: 20px; }
      .report-shell { max-width: 980px; margin: 0 auto; }
      .report-header { border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 18px; }
      .report-classification { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #334155; text-transform: uppercase; }
      .report-title { font-size: 26px; font-weight: 800; color: #0f172a; margin: 8px 0; }
      .report-meta { font-size: 12px; color: #334155; }
      .report-section { margin: 18px 0; page-break-inside: avoid; }
      .report-section h4 { margin: 0 0 8px; font-size: 15px; color: #0f172a; border-bottom: 1px solid #cbd5e1; padding-bottom: 4px; }
      .report-section p, .report-section li { color: #111827; }
      ul { margin: 8px 0 0 18px; padding: 0; }
      table { width: 100%; border-collapse: collapse; margin-top: 8px; }
      th, td { border: 1px solid #cbd5e1; padding: 7px 8px; text-align: left; vertical-align: top; }
      th { background: #e2e8f0; font-weight: 700; }
      .footer-note { border-top: 1px solid #cbd5e1; margin-top: 18px; padding-top: 10px; font-size: 11px; color: #475569; }
    </style>
  </head>
  <body>
    <div class="report-shell">${bodyMarkup}</div>
  </body>
</html>`);
  frameDoc.close();

  const runPrint = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 1500);
  };

  iframe.onload = () => window.setTimeout(runPrint, 300);
  window.setTimeout(runPrint, 900);
};

const buildPrintableReportHtml = ({
  mission,
  district,
  dateStr,
  summary,
  terrainStats,
  routes,
  droneMission,
  primaryCandidate,
  alternateCandidate,
  primaryRoute,
  recommendationReason,
  routeRisk,
  primaryRisks,
  rankedCandidates,
  batteryRows,
  greens,
  ambers,
  reds,
}) => {
  const routeSection = primaryRoute?.metrics
    ? `
      <ul>
        <li><strong>Start Source:</strong> Nearest Major Road Access</li>
        <li><strong>Road Distance:</strong> ${escapeHtml(((primaryRoute.metrics.road_distance_m || 0) / 1000).toFixed(2))} km</li>
        <li><strong>Final Access:</strong> ${escapeHtml(primaryRoute.metrics.offroad_distance_m || 0)} m</li>
        <li><strong>Estimated Time:</strong> ${escapeHtml(primaryRoute.metrics.estimated_time_min || 'N/A')} min</li>
        <li><strong>Feasibility:</strong> ${escapeHtml(primaryRoute.metrics.feasibility || 'Unknown')}</li>
        <li><strong>Main Route Risk:</strong> ${escapeHtml(routeRisk)}</li>
      </ul>
    `
    : `<p>Route analysis not planned.</p>`;

  const droneSection = droneMission
    ? `
      <ul>
        <li><strong>Drone Recce:</strong> Assigned</li>
        <li><strong>Waypoints:</strong> ${escapeHtml(droneMission.waypoint_count ?? 0)}</li>
        <li><strong>Survey Distance:</strong> ${escapeHtml(formatDistanceKm(droneMission.survey_distance_m))}</li>
        <li><strong>Verification Status:</strong> ${escapeHtml(droneVerificationLabel(droneMission))}</li>
      </ul>
    `
    : '<p>Drone recce not assigned.</p>';

  const candidateRows = rankedCandidates.slice(0, 5).map((candidate, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>Area ${escapeHtml(candidate.name)}</td>
      <td>${escapeHtml(Number(candidate.totalScore).toFixed(1))}</td>
      <td>${escapeHtml(candidateStatusLabel(candidate))}</td>
      <td>${escapeHtml(candidate.strengths?.[0] || 'Balanced terrain and access')}</td>
      <td>${escapeHtml(buildCriticalRisks(candidate, bestPlannedRoute(routes, candidate))[0] || candidate.weaknesses?.[0] || 'No major risk flagged')}</td>
    </tr>
  `).join('');

  const batteryAllocationRows = batteryRows.map((row) => `
    <tr>
      <td>Battery ${row.battery}</td>
      <td>${escapeHtml(row.candidate ? `Area ${row.candidate.name}` : 'Unallocated')}</td>
      <td>${escapeHtml(row.candidate ? Number(row.candidate.totalScore).toFixed(1) : '--')}</td>
      <td>${escapeHtml(row.capacity)}</td>
      <td>${escapeHtml(row.status)}</td>
    </tr>
  `).join('');

  return `
    <div class="report-header">
      <div class="report-classification">Demo / Restricted</div>
      <div class="report-title">Operational Recce Summary</div>
      <div class="report-meta">
        Mission: ${escapeHtml(mission.name)}<br />
        District: ${escapeHtml(district)} | Date: ${escapeHtml(dateStr)}<br />
        Gun System: ${escapeHtml(GUN_TYPES[mission.gunType]?.name || mission.gunType)} | Batteries: ${escapeHtml(mission.batteries)}
      </div>
    </div>

    <div class="report-section">
      <h4>1. Mission Summary</h4>
      <ul>
        <li><strong>Task:</strong> Identify the most suitable deployment areas for ${escapeHtml(mission.numGuns)} guns in ${escapeHtml(district)}.</li>
        <li><strong>Operational Context:</strong> Bearing ${escapeHtml(mission.targetBearing)} deg | ${escapeHtml(mission.dayNight)} operations | ${escapeHtml(mission.season)} season | ${escapeHtml(mission.threatLevel)} threat posture.</li>
        <li><strong>Assessment Outcome:</strong> ${escapeHtml(rankedCandidates.length)} candidate areas assessed, with ${escapeHtml(greens.length)} recommended, ${escapeHtml(ambers.length)} cautionary, and ${escapeHtml(reds.length)} avoid areas.</li>
      </ul>
    </div>

    <div class="report-section">
      <h4>2. Final Recommendation</h4>
      ${primaryCandidate ? `
        <ul>
          <li><strong>Primary Area:</strong> Area ${escapeHtml(primaryCandidate.name)}</li>
          <li><strong>Alternate Area:</strong> ${escapeHtml(alternateCandidate ? `Area ${alternateCandidate.name}` : 'Not available')}</li>
          <li><strong>Decision:</strong> ${escapeHtml(candidateStatusLabel(primaryCandidate))}</li>
          <li><strong>Reason:</strong> ${escapeHtml(recommendationReason)}</li>
          <li><strong>Key Risk:</strong> ${escapeHtml(primaryRisks[0] || routeRisk)}</li>
        </ul>
      ` : '<p>No recommendation can be issued until candidate ranking is available.</p>'}
    </div>

    <div class="report-section">
      <h4>3. AOI Summary</h4>
      <ul>
        <li><strong>AOI Coverage:</strong> ${escapeHtml(summary ? `${summary.aoiAreaSqKm} km²` : '--')}</li>
        <li><strong>Points Evaluated:</strong> ${escapeHtml(summary?.pointsEvaluated ?? '--')}</li>
        <li><strong>Points Accepted:</strong> ${escapeHtml(summary?.pointsAccepted ?? '--')}</li>
        <li><strong>Dominant Land Cover:</strong> ${escapeHtml(terrainStats?.dominantLandCover || 'Unknown')}</li>
      </ul>
    </div>

    <div class="report-section">
      <h4>4. Recommended Gun Areas</h4>
      <table>
        <thead>
          <tr><th>Rank</th><th>Area</th><th>Score</th><th>Status</th><th>Main Strength</th><th>Main Risk</th></tr>
        </thead>
        <tbody>${candidateRows}</tbody>
      </table>
    </div>

    <div class="report-section">
      <h4>5. Route and Access</h4>
      ${routeSection}
    </div>

    <div class="report-section">
      <h4>6. Drone Recce</h4>
      ${droneSection}
    </div>

    <div class="report-section">
      <h4>7. Risk Summary</h4>
      <ul>
        <li><strong>Terrain Risk:</strong> ${escapeHtml(terrainRiskLevel(primaryCandidate))}</li>
        <li><strong>Access Risk:</strong> ${escapeHtml(accessRiskLevel(primaryCandidate, primaryRoute))}</li>
        <li><strong>Civilian Risk:</strong> ${escapeHtml(civilianRiskLevel(primaryCandidate))}</li>
        <li><strong>Water/Drainage Risk:</strong> ${escapeHtml(waterRiskLevel(primaryCandidate, primaryRoute))}</li>
        <li><strong>Route Risk:</strong> ${escapeHtml(primaryRoute ? routeRiskLevel(primaryRoute) : 'Not Planned')}</li>
      </ul>
    </div>

    <div class="report-section">
      <h4>8. Battery Allocation</h4>
      <table>
        <thead>
          <tr><th>Battery</th><th>Assigned Area</th><th>Score</th><th>Capacity</th><th>Status</th></tr>
        </thead>
        <tbody>${batteryAllocationRows}</tbody>
      </table>
    </div>

    <div class="footer-note">
      Prepared by: ${escapeHtml(COMPANY.product)} (${escapeHtml(COMPANY.version)})<br />
      ${escapeHtml(COMPANY.name)}<br />
      Recommended for commander review before final deployment order.
    </div>
  `;
};

function DashboardView({ candidates, routes, summary, allocations, setAllocations, mission, setActiveTab, district, aoi, assemblyArea }) {
  const handleExportKml = () => {
    const kml = buildMissionKml({
      mission, district, candidates, routes, aoi, assemblyArea,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${(mission?.name || 'mission').replace(/\s+/g, '_')}_${stamp}.kml`;
    downloadKml(kml, filename);
  };
  if (!summary && !candidates.length) {
    return (
      <div className="empty-state" style={{ minHeight: 360 }}>
        <div className="empty-title">No mission analysis loaded</div>
        <div className="empty-description">
          Run AI PRE-SCREEN from the Mission tab to populate battery allocation, route timing, and candidate rankings.
        </div>
      </div>
    );
  }
  const greens = candidates.filter(c => c.rating === 'GREEN');
  const ambers = candidates.filter(c => c.rating === 'AMBER');
  const reds   = candidates.filter(c => c.rating === 'RED');
  const routeTimes = Object.values(routes || {})
    .map(route => Number(route?.metrics?.estimated_time_min ?? route?.estimatedTime))
    .filter(value => Number.isFinite(value) && value > 0);
  const bestDeployTime = routeTimes.length ? Math.min(...routeTimes) : null;
  const deployLabel = bestDeployTime == null
    ? '--'
    : bestDeployTime >= 60
      ? `${(bestDeployTime / 60).toFixed(1)}h`
      : `${Math.round(bestDeployTime)} min`;

  const dashCards = [
    {
      value: candidates.length,
      label: 'Areas Assessed',
      sub: <>
        <span style={{ color: 'var(--green)' }}><CheckCircle size={10} /> {greens.length}</span> · {' '}
        <span style={{ color: 'var(--amber)' }}><AlertTriangle size={10} /> {ambers.length}</span> · {' '}
        <span style={{ color: 'var(--red)' }}><XCircle size={10} /> {reds.length}</span>
      </>,
      color: 'var(--accent)',
    },
    {
      value: greens.length > 0 ? greens[0].totalScore : 0,
      label: 'Best Score',
      sub: `Area ${greens.length > 0 ? greens[0].name : '--'}`,
      color: 'var(--green)',
    },
    {
      value: null,
      label: 'AOI Coverage',
      sub: summary ? `${summary.pointsEvaluated} grid cells evaluated` : 'No AOI analysis yet',
      color: 'var(--accent)',
      display: summary ? `${summary.aoiAreaSqKm} km²` : '--',
    },
    {
      value: null,
      label: 'Best Deploy Time',
      sub: 'Shortest computed route',
      color: 'var(--accent)',
      display: deployLabel,
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <BarChart2 size={11} /> Commander Dashboard
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{mission.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {GUN_TYPES[mission.gunType]?.name} × {mission.numGuns} guns · {mission.batteries} batteries · Bearing {mission.targetBearing}°
        </div>
      </div>

      <div className="dashboard-grid">
        {dashCards.map((card, i) => (
          <motion.div key={card.label} className="dash-card"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1, duration: 0.3 }}
          >
            <div className="dash-card-value" style={{ color: card.color }}>
              {card.display ?? <AnimatedCounter to={card.value} />}
            </div>
            <div className="dash-card-label">{card.label}</div>
            <div className="dash-card-sub">{card.sub}</div>
          </motion.div>
        ))}
      </div>

      <div style={{ padding: '0 16px', marginTop: 20 }}>
        <div className="form-label" style={{ marginBottom: 12 }}>Battery Allocation</div>
        <table className="allocation-table">
          <thead>
            <tr><th>Battery</th><th>Gun Area</th><th>Score</th><th>Status</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: mission.batteries }, (_, i) => {
              const allocated = allocations[i + 1];
              const cand = allocated ? candidates.find(c => c.id === allocated) : null;
              return (
                <tr key={i} className="allocation-row">
                  <td style={{ fontWeight: 700 }}>Battery {i + 1}</td>
                  <td>
                    {cand ? (
                      <span>Area {cand.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({cand.gridRef})</span></span>
                    ) : (
                      <select className="form-select" style={{ width: 200, padding: '5px 8px', fontSize: 12 }}
                        value=""
                        onChange={e => setAllocations({ ...allocations, [i + 1]: parseInt(e.target.value) })}>
                        <option value="">Select Area...</option>
                        {candidates.filter(c => c.rating !== 'RED').map(c => (
                          <option key={c.id} value={c.id}>Area {c.name} ({c.totalScore})</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>
                    {cand && (
                      <span style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', color: cand.rating === 'GREEN' ? 'var(--green)' : 'var(--amber)' }}>
                        {cand.totalScore}
                      </span>
                    )}
                  </td>
                  <td>
                    {cand
                      ? <span className="tag tag-strength">Allocated</span>
                      : <span className="tag tag-warning">Unallocated</span>
                    }
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '0 16px', marginTop: 24, display: 'flex', gap: 12 }}>
        <motion.button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => setActiveTab('reports')}
        >
          <FileText size={13} /> Generate Recce Report
        </motion.button>
        <button className="btn-secondary" onClick={handleExportKml}>
          <Download size={12} /> Export KML
        </button>
        <button className="btn-secondary"><Share2 size={12} /> Share with HQ</button>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════ */
/*  REPORT VIEW                               */
/* ═══════════════════════════════════════════ */
function ReportView({ candidates, mission, district, terrainStats, summary, metadata }) {
  if (!summary && !candidates.length) {
    return (
      <div className="empty-state" style={{ minHeight: 360 }}>
        <div className="empty-title">No report content available yet</div>
        <div className="empty-description">
          The report is generated from mission-analysis output. Run AI PRE-SCREEN first so this view can use actual candidates and terrain results.
        </div>
      </div>
    );
  }
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const greens = candidates.filter(c => c.rating === 'GREEN' || c.rating === 'AMBER').sort((a, b) => b.totalScore - a.totalScore);
  const topCandidate = greens[0] || candidates[0] || null;

  return (
    <div className="report-container fade-in" data-printable="report">
      <div className="report-header">
        <div className="report-classification">SECRET</div>
        <div className="report-title">RECCE REPORT — {mission.name.toUpperCase()}</div>
        <div className="report-meta">
          Report No: 001/ALPHA-7/APR/2026 · Date: {dateStr}<br />
          Ref Map: SOI Sheet 43S/NH (1:50,000) · Generated by {COMPANY.product}
        </div>
      </div>

      <div className="report-section">
        <h4>1. General</h4>
        <ul>
          <li><strong>Task:</strong> AI-assisted reconnaissance for deployment of Medium Regiment ({GUN_TYPES[mission.gunType]?.name} × {mission.numGuns})</li>
          <li><strong>Area:</strong> {district} Operations Area</li>
          <li><strong>Method:</strong> Backend-served Dronacharya candidate ranking using district rasters, vector layers, and trained model artefacts</li>
          <li><strong>AOI Summary:</strong> {summary ? `${summary.aoiAreaSqKm} km² analysed, ${summary.pointsEvaluated} grid cells evaluated, ${summary.pointsAccepted} accepted for clustering` : 'Awaiting mission analysis output'}</li>
        </ul>
      </div>

      <div className="report-section">
        <h4>2. Terrain Assessment</h4>
        <ul>
          <li><strong>Ground:</strong> Average elevation {terrainStats.avgElevation}m ASL</li>
          <li><strong>Dominant Cover:</strong> {terrainStats.dominantLandCover}</li>
          <li><strong>Suitable Areas:</strong> {terrainStats.greenAreas} green, {terrainStats.amberAreas} amber, {terrainStats.redAreas} red</li>
          <li><strong>Water and Roads:</strong> Derived from the backend-served district raster and vector layers</li>
        </ul>
      </div>

      <div className="report-section">
        <h4>3. Gun Areas Recommended</h4>
        {greens.length ? greens.map((c, i) => {
          const area = candidateAreaMetrics(c);
          const gunFit = candidateGunFit(c);
          const canopyDensity = candidateCanopyDensity(c);
          return <div key={c.id} style={{
            background: 'var(--bg-card)', border: '1px solid var(--border-default)',
            borderRadius: 10, padding: 16, marginBottom: 12,
            borderLeft: `3px solid ${c.rating === 'GREEN' ? 'var(--green)' : 'var(--amber)'}`,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>
                {i === 0 ? '(a) RECOMMENDED' : `(${String.fromCharCode(98 + i - 1)}) ALTERNATE`} — Area {c.name}
              </div>
              <span style={{ fontWeight: 800, fontFamily: 'var(--font-mono)', fontSize: 18, color: c.rating === 'GREEN' ? 'var(--green)' : 'var(--amber)' }}>
                {c.totalScore}/100
              </span>
            </div>
            <table className="param-table">
              <tbody>
                <tr><td>Grid Reference</td><td>{c.gridRef}</td></tr>
                <tr><td>Elevation</td><td>{c.elevation} m ASL</td></tr>
                <tr><td>Slope</td><td>{c.terrain.avgSlope}° avg / {c.terrain.maxSlope}° max</td></tr>
                <tr><td>Ground</td><td>{c.terrain.soilType} ({c.terrain.bearingKpa} kPa)</td></tr>
                <tr><td>Dimensions</td><td>{area.length} x {area.width} m ({area.availableAreaKm2.toFixed(3)} km2 local patch)</td></tr>
                <tr><td>Gun Capacity</td><td>{gunFit.estimated_gun_capacity ?? c.maxGunsFit} theoretical - {gunFit.guns_fit_status || 'N/A'}</td></tr>
                <tr><td>Cover</td><td>{c.terrain.coverSides}/4 sides - {canopyDensity}% canopy</td></tr>
                <tr><td>Access</td><td>{c.access.nearestRoadDist}m via {c.access.roadType}</td></tr>
              </tbody>
            </table>
          </div>;
        }) : (
          <p>No backend-ranked candidate areas are available for {district} in the current session.</p>
        )}
      </div>

      <div className="report-section">
        <h4>5. Model Context</h4>
        <ul>
          <li><strong>Holdout District:</strong> {metadata?.holdout_district || 'Not reported'}</li>
          <li><strong>Training Rows:</strong> {metadata?.training_rows?.toLocaleString?.() || metadata?.training_rows || 'Not reported'}</li>
          <li><strong>Feature Count:</strong> {metadata?.feature_cols?.length || 'Not reported'}</li>
          <li><strong>Regression MAE (holdout):</strong> {metadata?.reg_mae_holdout != null ? Number(metadata.reg_mae_holdout).toFixed(3) : 'Not reported'}</li>
          <li><strong>Regression R² (holdout):</strong> {metadata?.reg_r2_holdout != null ? Number(metadata.reg_r2_holdout).toFixed(3) : 'Not reported'}</li>
        </ul>
      </div>

      <div className="report-section">
        <h4>6. Recommendations</h4>
        {topCandidate ? (
          <>
            <p>Primary recommendation: deploy the lead battery to Area {topCandidate.name} ({topCandidate.totalScore}/100) in {district}.</p>
            <p style={{ marginTop: 8 }}>
              Ground summary: {topCandidate.terrain.soilType}, average slope {topCandidate.terrain.avgSlope}°, nearest road {topCandidate.access.nearestRoadDist} m.
            </p>
          </>
        ) : (
          <p>No recommendation can be generated until candidate results are available from the backend.</p>
        )}
      </div>

      <div style={{ borderTop: '2px solid var(--border-default)', paddingTop: 16, marginTop: 24 }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Prepared by: {COMPANY.product} ({COMPANY.version})<br />
          {COMPANY.name}<br />
          Reviewed by: _________________________ (2IC Signature)
        </p>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10 }} className="report-actions">
        <motion.button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => window.print()}
          title="Use the browser's Save-as-PDF in the print dialog"
        >
          <Download size={13} /> Download PDF
        </motion.button>
        <button className="btn-secondary" onClick={() => {
          const kml = buildMissionKml({ mission, district, candidates });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          downloadKml(kml, `${(mission?.name || 'mission').replace(/\s+/g, '_')}_${stamp}.kml`);
        }}>
          <Download size={12} /> Export KML
        </button>
        <button className="btn-secondary"><Pencil size={12} /> Edit Report</button>
        <button className="btn-secondary"><Share2 size={12} /> Share</button>
      </div>
    </div>
  );
}

function DashboardViewEnhanced({ candidates, routes, summary, allocations, setAllocations, mission, setActiveTab, district, aoi, assemblyArea }) {
  const handleExportKml = () => {
    const kml = buildMissionKml({
      mission, district, candidates, routes, aoi, assemblyArea,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `${(mission?.name || 'mission').replace(/\s+/g, '_')}_${stamp}.kml`;
    downloadKml(kml, filename);
  };

  if (!summary && !candidates.length) {
    return (
      <div className="empty-state" style={{ minHeight: 360 }}>
        <div className="empty-title">No mission analysis loaded</div>
        <div className="empty-description">
          Run AI PRE-SCREEN from the Mission tab to populate battery allocation, route timing, and candidate rankings.
        </div>
      </div>
    );
  }

  const greens = candidates.filter((candidate) => candidate.rating === 'GREEN');
  const ambers = candidates.filter((candidate) => candidate.rating === 'AMBER');
  const reds = candidates.filter((candidate) => candidate.rating === 'RED');
  const primaryCandidate = bestCandidateForMission(candidates);
  const primaryRoute = bestPlannedRoute(routes, primaryCandidate);
  const criticalRisks = buildCriticalRisks(primaryCandidate, primaryRoute);
  const routeTimes = Object.values(routes || {})
    .map((route) => Number(route?.metrics?.estimated_time_min ?? route?.estimatedTime))
    .filter((value) => Number.isFinite(value) && value > 0);
  const bestDeployTime = routeTimes.length ? Math.min(...routeTimes) : null;
  const deployLabel = bestDeployTime == null
    ? 'Route not planned'
    : bestDeployTime >= 60
      ? `${(bestDeployTime / 60).toFixed(1)}h`
      : `${Math.round(bestDeployTime)} min`;

  const dashCards = [
    {
      label: 'Areas Assessed',
      color: 'var(--accent)',
      display: String(candidates.length),
      sub: (
        <>
          <span style={{ color: 'var(--green)' }}><CheckCircle size={10} /> {greens.length}</span> ·{' '}
          <span style={{ color: 'var(--amber)' }}><AlertTriangle size={10} /> {ambers.length}</span> ·{' '}
          <span style={{ color: 'var(--red)' }}><XCircle size={10} /> {reds.length}</span>
        </>
      ),
    },
    {
      label: 'Best Score',
      color: primaryCandidate ? 'var(--green)' : 'var(--accent)',
      display: primaryCandidate ? Number(primaryCandidate.totalScore).toFixed(1) : '--',
      sub: primaryCandidate ? `Area ${primaryCandidate.name}` : 'Area --',
    },
    {
      label: 'Recommended Area',
      color: primaryCandidate?.rating === 'GREEN' ? 'var(--green)' : primaryCandidate?.rating === 'AMBER' ? 'var(--amber)' : 'var(--red)',
      display: primaryCandidate ? `Area ${primaryCandidate.name}` : '--',
      sub: primaryCandidate ? `Status: ${candidateStatusLabel(primaryCandidate)} · Score: ${Number(primaryCandidate.totalScore).toFixed(1)}/100` : 'Awaiting mission analysis',
    },
    {
      label: 'Critical Risks',
      color: criticalRisks.length ? 'var(--amber)' : 'var(--green)',
      display: criticalRisks.length ? `${criticalRisks.length} Active` : 'None Detected',
      sub: criticalRisks.length ? criticalRisks.join(' · ') : 'No major risks identified',
    },
    {
      label: 'AOI Coverage',
      color: 'var(--accent)',
      display: summary ? `${summary.aoiAreaSqKm} km²` : '--',
      sub: summary ? `${summary.pointsEvaluated} grid cells evaluated` : 'No AOI analysis yet',
    },
    {
      label: 'Best Deploy Time',
      color: bestDeployTime == null ? 'var(--text-secondary)' : 'var(--accent)',
      display: deployLabel,
      sub: bestDeployTime == null ? 'Route not planned' : 'Shortest computed route',
    },
    {
      label: 'Route Feasibility',
      color: primaryRoute?.metrics?.feasibility === 'Excellent' || primaryRoute?.metrics?.feasibility === 'Good'
        ? 'var(--green)'
        : primaryRoute?.metrics?.feasibility === 'Moderate'
          ? 'var(--amber)'
          : 'var(--red)',
      display: primaryRoute?.metrics?.feasibility || 'Not Planned',
      sub: primaryRoute?.metrics
        ? `Total ${((primaryRoute.metrics.total_distance_m || 0) / 1000).toFixed(2)} km · Final ${primaryRoute.metrics.offroad_distance_m || 0} m`
        : 'Route analysis pending',
    },
  ];

  return (
    <div style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1.5, display: 'flex', alignItems: 'center', gap: 6 }}>
          <BarChart2 size={11} /> Commander Dashboard
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, marginTop: 4 }}>{mission.name}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
          {GUN_TYPES[mission.gunType]?.name} x {mission.numGuns} guns · {mission.batteries} batteries · Bearing {mission.targetBearing} deg
        </div>
      </div>

      <div className="dashboard-grid">
        {dashCards.map((card, index) => (
          <motion.div key={card.label} className="dash-card"
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.08, duration: 0.25 }}
          >
            <div className="dash-card-value" style={{ color: card.color }}>{card.display}</div>
            <div className="dash-card-label">{card.label}</div>
            <div className="dash-card-sub">{card.sub}</div>
          </motion.div>
        ))}
      </div>

      <div style={{ padding: '0 16px', marginTop: 20 }}>
        <div className="form-label" style={{ marginBottom: 12 }}>Battery Allocation</div>
        <table className="allocation-table">
          <thead>
            <tr><th>Battery</th><th>Gun Area</th><th>Score</th><th>Capacity</th><th>Status</th></tr>
          </thead>
          <tbody>
            {Array.from({ length: mission.batteries }, (_, index) => {
              const allocated = allocations[index + 1];
              const candidate = allocated ? candidates.find((item) => item.id === allocated) : null;
              const status = candidateAllocationStatus(candidate);
              return (
                <tr key={index} className="allocation-row">
                  <td style={{ fontWeight: 700 }}>Battery {index + 1}</td>
                  <td>
                    {candidate ? (
                      <span>Area {candidate.name} <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>({candidate.gridRef})</span></span>
                    ) : (
                      <select
                        className="form-select"
                        style={{ width: 220, padding: '5px 8px', fontSize: 12 }}
                        value=""
                        onChange={(event) => setAllocations({ ...allocations, [index + 1]: parseInt(event.target.value, 10) })}
                      >
                        <option value="">Select Area...</option>
                        {candidates.filter((item) => item.rating !== 'RED').map((item) => (
                          <option key={item.id} value={item.id}>Area {item.name} ({item.totalScore})</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td>{candidate ? <span style={{ fontWeight: 800, fontFamily: 'var(--font-mono)' }}>{Number(candidate.totalScore).toFixed(1)}</span> : '--'}</td>
                  <td>{candidate ? candidateCapacityLabel(candidate) : '--'}</td>
                  <td>
                    {candidate ? (
                      <span className={status === 'Allocated' ? 'tag tag-strength' : status === 'Unallocated' ? 'tag tag-warning' : 'tag tag-rejection'}>
                        {status}
                      </span>
                    ) : (
                      <span className="tag tag-warning">Unallocated</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ padding: '0 16px', marginTop: 24, display: 'flex', gap: 12 }}>
        <motion.button className="btn-primary" style={{ width: 'auto', padding: '10px 20px' }}
          whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
          onClick={() => setActiveTab('reports')}
        >
          <FileText size={13} /> Generate Recce Report
        </motion.button>
        <button className="btn-secondary" onClick={handleExportKml}>
          <Download size={12} /> Export KML
        </button>
        <button className="btn-secondary"><Share2 size={12} /> Share with HQ</button>
      </div>
    </div>
  );
}

function ReportViewEnhanced({ candidates, routes, droneMissions, allocations, mission, district, terrainStats, summary }) {
  const reportRef = useRef(null);
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });

  if (!summary && !candidates.length) {
    return (
      <div className="empty-state" style={{ minHeight: 360 }}>
        <div className="empty-title">No report content available yet</div>
        <div className="empty-description">
          Run AI PRE-SCREEN first so this view can assemble a field-ready recce summary from the active mission output.
        </div>
      </div>
    );
  }

  const rankedCandidates = [...(candidates || [])].sort((a, b) => Number(b.totalScore || 0) - Number(a.totalScore || 0));
  const greens = rankedCandidates.filter((candidate) => candidate.rating === 'GREEN');
  const ambers = rankedCandidates.filter((candidate) => candidate.rating === 'AMBER');
  const reds = rankedCandidates.filter((candidate) => candidate.rating === 'RED');
  const primaryCandidate = rankedCandidates[0] || null;
  const alternateCandidate = rankedCandidates[1] || null;
  const primaryRoute = bestPlannedRoute(routes, primaryCandidate);
  const primaryDroneMission = droneMissionForCandidate(droneMissions, primaryCandidate) || firstAvailableDroneMission(droneMissions);
  const primaryRisks = buildCriticalRisks(primaryCandidate, primaryRoute);
  const recommendationReason = primaryCandidate
    ? `Best balance of terrain, access, deployment area, and standoff in ${district}.`
    : 'Awaiting mission analysis.';
  const routeRisk = routeMainRisk(primaryRoute);
  const batteryRows = Array.from({ length: mission.batteries }, (_, index) => {
    const allocated = allocations[index + 1];
    const candidate = allocated ? candidates.find((item) => item.id === allocated) : null;
    return {
      battery: index + 1,
      candidate,
      status: candidateAllocationStatus(candidate),
      capacity: candidateCapacityLabel(candidate),
    };
  });

  return (
    <div className="report-container fade-in" data-printable="report" ref={reportRef}>
      <div className="report-header">
        <div className="report-classification">DEMO / RESTRICTED</div>
        <div className="report-title">OPERATIONAL RECCE SUMMARY</div>
        <div className="report-meta">
          Mission: {mission.name}<br />
          District: {district} · Date: {dateStr}<br />
          Gun System: {GUN_TYPES[mission.gunType]?.name} · Batteries: {mission.batteries}
        </div>
      </div>

      <div className="report-section">
        <h4>1. Mission Summary</h4>
        <ul>
          <li><strong>Task:</strong> Identify the most suitable deployment areas for {mission.numGuns} guns in {district}.</li>
          <li><strong>Operational Context:</strong> Bearing {mission.targetBearing} deg · {mission.dayNight} operations · {mission.season} season · {mission.threatLevel} threat posture.</li>
          <li><strong>Assessment Outcome:</strong> {rankedCandidates.length} candidate areas assessed, with {greens.length} recommended, {ambers.length} cautionary, and {reds.length} avoid areas.</li>
        </ul>
      </div>

      <div className="report-section">
        <h4>2. Final Recommendation</h4>
        {primaryCandidate ? (
          <ul>
            <li><strong>Primary Area:</strong> Area {primaryCandidate.name}</li>
            <li><strong>Alternate Area:</strong> {alternateCandidate ? `Area ${alternateCandidate.name}` : 'Not available'}</li>
            <li><strong>Decision:</strong> {candidateStatusLabel(primaryCandidate)}</li>
            <li><strong>Reason:</strong> {recommendationReason}</li>
            <li><strong>Key Risk:</strong> {primaryRisks[0] || routeRisk}</li>
          </ul>
        ) : (
          <p>No recommendation can be issued until candidate ranking is available.</p>
        )}
      </div>

      <div className="report-section">
        <h4>3. AOI Summary</h4>
        <ul>
          <li><strong>AOI Coverage:</strong> {summary ? `${summary.aoiAreaSqKm} km²` : '--'}</li>
          <li><strong>Points Evaluated:</strong> {summary?.pointsEvaluated ?? '--'}</li>
          <li><strong>Points Accepted:</strong> {summary?.pointsAccepted ?? '--'}</li>
          <li><strong>Dominant Land Cover:</strong> {terrainStats?.dominantLandCover || 'Unknown'}</li>
        </ul>
      </div>

      <div className="report-section">
        <h4>4. Recommended Gun Areas</h4>
        <table className="allocation-table">
          <thead>
            <tr><th>Rank</th><th>Area</th><th>Score</th><th>Status</th><th>Main Strength</th><th>Main Risk</th></tr>
          </thead>
          <tbody>
            {rankedCandidates.slice(0, 5).map((candidate, index) => (
              <tr key={candidate.id} className="allocation-row">
                <td>{index + 1}</td>
                <td>Area {candidate.name}</td>
                <td>{Number(candidate.totalScore).toFixed(1)}</td>
                <td>{candidateStatusLabel(candidate)}</td>
                <td>{candidate.strengths?.[0] || 'Balanced terrain and access'}</td>
                <td>{buildCriticalRisks(candidate, bestPlannedRoute(routes, candidate))[0] || candidate.weaknesses?.[0] || 'No major risk flagged'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="report-section">
        <h4>5. Route and Access</h4>
        {primaryRoute?.metrics ? (
          <ul>
            <li><strong>Start Source:</strong> Nearest Major Road Access</li>
            <li><strong>Road Distance:</strong> {((primaryRoute.metrics.road_distance_m || 0) / 1000).toFixed(2)} km</li>
            <li><strong>Final Access:</strong> {primaryRoute.metrics.offroad_distance_m || 0} m</li>
            <li><strong>Estimated Time:</strong> {primaryRoute.metrics.estimated_time_min || 'N/A'} min</li>
            <li><strong>Feasibility:</strong> {primaryRoute.metrics.feasibility || 'Unknown'}</li>
            <li><strong>Main Route Risk:</strong> {routeRisk}</li>
          </ul>
        ) : (
          <p>Route analysis not planned.</p>
        )}
      </div>

      <div className="report-section">
        <h4>6. Drone Recce</h4>
        {primaryDroneMission ? (
          <ul>
            <li><strong>Drone Recce:</strong> Assigned</li>
            <li><strong>Waypoints:</strong> {primaryDroneMission.waypoint_count ?? 0}</li>
            <li><strong>Survey Distance:</strong> {formatDistanceKm(primaryDroneMission.survey_distance_m)}</li>
            <li><strong>Verification Status:</strong> {droneVerificationLabel(primaryDroneMission)}</li>
          </ul>
        ) : (
          <p>Drone recce not assigned.</p>
        )}
      </div>

      <div className="report-section">
        <h4>7. Risk Summary</h4>
        <ul>
          <li><strong>Terrain Risk:</strong> {terrainRiskLevel(primaryCandidate)}</li>
          <li><strong>Access Risk:</strong> {accessRiskLevel(primaryCandidate, primaryRoute)}</li>
          <li><strong>Civilian Risk:</strong> {civilianRiskLevel(primaryCandidate)}</li>
          <li><strong>Water/Drainage Risk:</strong> {waterRiskLevel(primaryCandidate, primaryRoute)}</li>
          <li><strong>Route Risk:</strong> {primaryRoute ? routeRiskLevel(primaryRoute) : 'Not Planned'}</li>
        </ul>
      </div>

      <div className="report-section">
        <h4>8. Battery Allocation</h4>
        <table className="allocation-table">
          <thead>
            <tr><th>Battery</th><th>Assigned Area</th><th>Score</th><th>Capacity</th><th>Status</th></tr>
          </thead>
          <tbody>
            {batteryRows.map((row) => (
              <tr key={row.battery} className="allocation-row">
                <td>Battery {row.battery}</td>
                <td>{row.candidate ? `Area ${row.candidate.name}` : 'Unallocated'}</td>
                <td>{row.candidate ? Number(row.candidate.totalScore).toFixed(1) : '--'}</td>
                <td>{row.capacity}</td>
                <td>{row.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ borderTop: '2px solid var(--border-default)', paddingTop: 16, marginTop: 24 }}>
        <p style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Prepared by: {COMPANY.product} ({COMPANY.version})<br />
          {COMPANY.name}<br />
          Recommended for commander review before final deployment order.
        </p>
      </div>

      <div style={{ marginTop: 20, display: 'flex', gap: 10 }} className="report-actions">
        <motion.button
          className="btn-primary"
          style={{ width: 'auto', padding: '10px 20px' }}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.97 }}
          onClick={() => printStandaloneHtml(
            `${mission.name} Report`,
            buildPrintableReportHtml({
              mission,
              district,
              dateStr,
              summary,
              terrainStats,
              routes,
              droneMission: primaryDroneMission,
              primaryCandidate,
              alternateCandidate,
              primaryRoute,
              recommendationReason,
              routeRisk,
              primaryRisks,
              rankedCandidates,
              batteryRows,
              greens,
              ambers,
              reds,
            }),
          )}
        >
          <Download size={13} /> Download PDF
        </motion.button>
        <button className="btn-secondary" onClick={() => {
          const kml = buildMissionKml({ mission, district, candidates, routes });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          downloadKml(kml, `${(mission?.name || 'mission').replace(/\s+/g, '_')}_${stamp}.kml`);
        }}>
          <Download size={12} /> Export KML
        </button>
        <button className="btn-secondary"><Pencil size={12} /> Edit Report</button>
        <button className="btn-secondary"><Share2 size={12} /> Share</button>
      </div>
    </div>
  );
}
